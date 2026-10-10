"use strict";

const { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen, shell } = require("electron");
const { keepClear } = require("./appearance");
const { cockpitWindowOptions } = require("./cockpit-window");
const { jsonPrefs } = require("./prefs");
const { openSettings, permissions, readFrontContext, requestPermissions } = require("./front-context");
const { HEIGHTS, WIDTH } = require("./quick-composer-layout");
const { createPlacement } = require("./quick-composer-placement");
const prefs = jsonPrefs("quick-composer.json", { asked: false }, (raw) => ({ asked: raw?.asked === true }), "quick composer");
const REMEMBER_MS = 60_000;

function panelOptions() {
  const { webPreferences } = cockpitWindowOptions("Quick Composer");
  return {
    type: "panel",
    title: "Quick Composer",
    width: WIDTH,
    height: HEIGHTS.compact,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
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

/** The global shortcut and the panel it opens over any app; `openRoute` brings a cockpit window to a path. */
function createQuickComposer({ appUrl, openRoute, readContext = readFrontContext, log = () => {} }) {
  let win = null;
  let chord = "";
  let suspended = false;
  let latest = null;
  let holding = false;
  let reloaded = false;
  let held = null;
  let forget = null;
  let fresh = false;
  let returnTo = null;
  const placement = createPlacement({ screen, window: () => win });

  const recover = (reason) => {
    log(`quick composer page failed: ${reason}`);
    if (reloaded || !win || win.isDestroyed()) return;
    reloaded = true;
    win.webContents.reload();
  };

  const panel = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow(panelOptions());
    keepClear(win);
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.on("moved", () => {
      placement.settle();
      win.webContents.send("telar:quick-composer:moved");
    });
    win.on("focus", () => {
      holding = false;
      win.webContents.send("telar:quick-composer:moved", { ifIdle: true });
      win.webContents.send("telar:quick-composer:permissions", permissions());
    });
    win.on("blur", () => holding || hide({ giveBack: false }));
    win.webContents.on("render-process-gone", (_event, details) => recover(`renderer gone (${details?.reason})`));
    win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => isMainFrame && recover(`load failed ${code} ${description}`));
    win.loadURL(new URL("/surface/quick", appUrl).href);
    return win;
  };

  const giveFocusBack = () => {
    const previous = returnTo;
    returnTo = null;
    if (previous && !previous.isDestroyed()) {
      previous.focus();
      previous.webContents.focus();
      previous.webContents.send("telar:focus:restore");
      return;
    }
    const others = BrowserWindow.getAllWindows().filter((other) => other !== win && !other.isDestroyed() && other.isVisible());
    if (process.platform === "darwin" && others.length === 0) app.hide();
  };

  const hide = ({ giveBack = true } = {}) => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    held = { ...placement.held(), mode: placement.mode() };
    win.hide();
    if (giveBack) giveFocusBack();
    else returnTo = null;
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
    const focused = BrowserWindow.getFocusedWindow();
    returnTo = focused && focused !== target ? focused : null;
    placement.open(held, held?.mode);
    latest = { ...(await readContext()), fresh };
    fresh = false;
    target.webContents.send("telar:quick-composer:open", latest);
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
  ipcMain.on("telar:quick-composer:mode", (event, mode) => fromPanel(event) && placement.resize(mode));
  ipcMain.handle("telar:quick-composer:open-settings", (event, permission) => fromPanel(event) && openSettings(permission, (url) => shell.openExternal(url)));
  ipcMain.on("telar:quick-composer:failed", (event, message) => fromPanel(event) && recover(`page error ${String(message).slice(0, 2000)}`));
  ipcMain.on("telar:quick-composer:hold", (event) => {
    if (fromPanel(event)) holding = true;
  });
  ipcMain.handle("telar:quick-composer:sent", (event, { route, title, detail, open } = {}) => {
    if (!fromPanel(event) || typeof route !== "string" || !route.startsWith("/")) return;
    hide({ giveBack: !open });
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
