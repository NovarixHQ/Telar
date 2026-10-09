"use strict";

const { app, BrowserWindow, globalShortcut, ipcMain, Notification, screen, shell } = require("electron");
const { cockpitWindowOptions } = require("./cockpit-window");
const { jsonPrefs } = require("./prefs");
const { openSettings, permissions, readFrontContext, requestPermissions } = require("./front-context");

const WIDTH = 680;
const MAX_HEIGHT = 640;

const isSpot = (spot) => Number.isFinite(spot?.x) && Number.isFinite(spot?.y);
const prefs = jsonPrefs(
  "quick-composer.json",
  { asked: false, positions: {} },
  (raw) => ({ asked: raw?.asked === true, positions: Object.fromEntries(Object.entries(raw?.positions ?? {}).filter(([, spot]) => isSpot(spot))) }),
  "quick composer",
);

function panelOptions() {
  const { webPreferences } = cockpitWindowOptions("Quick Composer");
  return {
    type: "panel",
    title: "Quick Composer",
    width: WIDTH,
    height: 200,
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

const fits = ({ x, y, width, height }, spot) => spot.x >= x && spot.x + WIDTH <= x + width && spot.y >= y && spot.y < y + height - 80;

function placeNearCursor(win) {
  const { id, workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const spot = prefs.read().positions[id];
  if (spot && fits(workArea, spot)) return win.setPosition(spot.x, spot.y);
  win.setPosition(Math.round(workArea.x + (workArea.width - WIDTH) / 2), Math.round(workArea.y + workArea.height * 0.2));
}

function remember(win) {
  const [x, y] = win.getPosition();
  const { id } = screen.getDisplayMatching({ x, y, width: WIDTH, height: 1 });
  const saved = prefs.read();
  prefs.write({ ...saved, positions: { ...saved.positions, [id]: { x, y } } });
}

/** The global shortcut and the panel it opens over any app; `openRoute` brings a cockpit window to a path. */
function createQuickComposer({ appUrl, openRoute, readContext = readFrontContext, log = () => {} }) {
  let win = null;
  let chord = "";
  let suspended = false;
  let latest = null;
  let holding = false;
  let dragFrom = null;

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
    win.loadURL(new URL("/surface/quick", appUrl).href);
    return win;
  };

  const hide = () => {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  };

  const show = async () => {
    const target = panel();
    const ownSourceIds = BrowserWindow.getAllWindows().map((other) => other.getMediaSourceId?.()).filter(Boolean);
    if (!prefs.read().asked) {
      prefs.write({ ...prefs.read(), asked: true });
      await requestPermissions();
    }
    latest = await readContext({ ownSourceIds });
    placeNearCursor(target);
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
  ipcMain.on("telar:quick-composer:resize", (event, { height } = {}) => {
    if (!fromPanel(event) || !Number.isFinite(height)) return;
    win.setContentSize(WIDTH, Math.min(MAX_HEIGHT, Math.max(120, Math.ceil(height))));
  });
  ipcMain.handle("telar:quick-composer:open-settings", (event, permission) => fromPanel(event) && openSettings(permission, (url) => shell.openExternal(url)));
  ipcMain.on("telar:quick-composer:drag", (event, { phase, dx, dy } = {}) => {
    if (!fromPanel(event)) return;
    if (phase === "start") {
      const [x, y] = win.getPosition();
      dragFrom = { x, y };
    } else if (phase === "move" && dragFrom && Number.isFinite(dx) && Number.isFinite(dy)) {
      win.setPosition(Math.round(dragFrom.x + dx), Math.round(dragFrom.y + dy));
    } else if (phase === "end" && dragFrom) {
      dragFrom = null;
      remember(win);
    }
  });
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
