"use strict";

const { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen, shell } = require("electron");
const { cockpitWindowOptions } = require("./cockpit-window");
const { jsonPrefs } = require("./prefs");
const { openSettings, permissions, readFrontContext, requestPermissions } = require("./front-context");

const isSpot = (spot) => Number.isFinite(spot?.x) && Number.isFinite(spot?.y);
const prefs = jsonPrefs("quick-composer.json", { asked: false }, (raw) => ({ asked: raw?.asked === true }), "quick composer");
const REMEMBER_MS = 60_000;

function panelOptions() {
  const { webPreferences } = cockpitWindowOptions("Quick Composer");
  return {
    type: "panel",
    title: "Quick Composer",
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences,
  };
}

function cover(win, display) {
  win.setBounds(display.workArea);
  return { width: display.workArea.width, height: display.workArea.height };
}

function displayFor(held) {
  if (!held) return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return screen.getAllDisplays().find((each) => each.id === held.display) ?? screen.getPrimaryDisplay();
}

/** The global shortcut and the panel it opens over any app; `openRoute` brings a cockpit window to a path. */
function createQuickComposer({ appUrl, openRoute, readContext = readFrontContext, log = () => {} }) {
  let win = null;
  let chord = "";
  let suspended = false;
  let latest = null;
  let holding = false;
  let display = null;
  let reloaded = false;
  let held = null;
  let forget = null;
  let fresh = false;

  const recover = (reason) => {
    log(`quick composer page failed: ${reason}`);
    if (reloaded || !win || win.isDestroyed()) return;
    reloaded = true;
    win.webContents.reload();
  };

  const panel = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow(panelOptions());
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.on("focus", () => {
      holding = false;
      win.webContents.send("telar:quick-composer:permissions", permissions());
    });
    win.on("blur", () => holding || hide());
    win.webContents.on("render-process-gone", (_event, details) => recover(`renderer gone (${details?.reason})`));
    win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => isMainFrame && recover(`load failed ${code} ${description}`));
    win.loadURL(new URL("/surface/quick", appUrl).href);
    return win;
  };

  const hide = () => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.hide();
    clearTimeout(forget);
    forget = setTimeout(() => {
      held = null;
      fresh = true;
    }, REMEMBER_MS);
  };

  const show = async () => {
    const target = panel();
    if (!prefs.read().asked) {
      prefs.write({ ...prefs.read(), asked: true });
      await requestPermissions();
    }
    clearTimeout(forget);
    const next = displayFor(held);
    display = next.id;
    const area = cover(target, next);
    latest = { ...(await readContext()), spot: held?.display === display ? held.spot : null, area, fresh };
    fresh = false;
    target.webContents.send("telar:quick-composer:open", latest);
    target.setIgnoreMouseEvents(true, { forward: true });
    target.show();
    target.focus();
  };

  const toggle = () => (win && !win.isDestroyed() && win.isVisible() ? hide() : show().catch((error) => log(`quick composer failed to open: ${error?.message || error}`)));

  const register = () => {
    if (!chord || suspended) return;
    if (!globalShortcut.register(chord, toggle)) log(`quick composer could not claim ${chord}`);
  };

  const unregister = () => {
    if (chord && globalShortcut.isRegistered(chord)) globalShortcut.unregister(chord);
  };

  const fromPanel = (event) => win !== null && !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.handle("telar:quick-composer:toggle", () => toggle());
  ipcMain.handle("telar:quick-composer:context", (event) => (fromPanel(event) ? latest : null));
  ipcMain.handle("telar:quick-composer:close", (event) => fromPanel(event) && hide());
  ipcMain.on("telar:quick-composer:interactive", (event, on) => fromPanel(event) && win.setIgnoreMouseEvents(on !== true, { forward: true }));
  ipcMain.on("telar:quick-composer:cross", (event, { grabX, grabY } = {}) => {
    if (!fromPanel(event) || !Number.isFinite(grabX) || !Number.isFinite(grabY)) return;
    const cursor = screen.getCursorScreenPoint();
    const next = screen.getDisplayNearestPoint(cursor);
    if (next.id === display) return;
    display = next.id;
    const area = cover(win, next);
    win.webContents.send("telar:quick-composer:place", { spot: { x: cursor.x - next.workArea.x - grabX, y: cursor.y - next.workArea.y - grabY }, area });
  });
  ipcMain.on("telar:quick-composer:moved", (event, spot) => {
    if (fromPanel(event) && display !== null && isSpot(spot)) held = { display, spot: { x: Math.round(spot.x), y: Math.round(spot.y) } };
  });
  ipcMain.handle("telar:quick-composer:open-settings", (event, permission) => fromPanel(event) && openSettings(permission, (url) => shell.openExternal(url)));
  ipcMain.on("telar:quick-composer:failed", (event, message) => fromPanel(event) && recover(`page error ${String(message).slice(0, 2000)}`));
  ipcMain.on("telar:quick-composer:hold", (event) => {
    if (fromPanel(event)) holding = true;
  });
  ipcMain.handle("telar:quick-composer:sent", (event, { route, title, detail, open } = {}) => {
    if (!fromPanel(event) || typeof route !== "string" || !route.startsWith("/")) return;
    hide();
    const go = () => {
      app.focus({ steal: true });
      openRoute(route);
    };
    if (open) return go();
    const notice = new Notification({ title: "Started in Telar", body: [title && `“${title}”`, detail].filter(Boolean).join(" · "), actions: [{ type: "button", text: "Open" }] });
    notice.on("click", go);
    notice.on("action", go);
    notice.show();
  });
  app.on("will-quit", unregister);
  panel();

  return {
    bind(next) {
      unregister();
      chord = next;
      register();
    },
    /** Held off while a chord is being recorded, so pressing it reaches the recorder. */
    suspend(on) {
      suspended = on;
      if (on) unregister();
      else register();
    },
    toggle,
  };
}

module.exports = { createQuickComposer };
