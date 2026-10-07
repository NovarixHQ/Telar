const path = require("node:path");
const { BrowserWindow, nativeTheme, screen } = require("electron");
const { createExternalLinkPolicy } = require("../browser/browser-manager");
const { backdropWindowOptions } = require("../main/window-material");
const { applyExternalLinkPolicy } = require("../main/window-links");
const { placeOnDisplays } = require("./surface-window-store");
const { FULL_MIN, compactPlace, setCompact } = require("./compact-window");

const TITLES = { browser: "Browser" };

function surfaceUrl(appUrl, kind, params) {
  const url = new URL(`/surface/${kind}`, appUrl);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.href;
}

function rememberedPlace(store, kind, key) {
  const saved = store?.get(kind, key);
  if (!saved) return { saved: null, bounds: { width: 1100, height: 800 } };
  return { saved, bounds: placeOnDisplays(saved, screen.getAllDisplays(), screen.getPrimaryDisplay()) };
}

function trackPlace(win, store, kind, key) {
  const record = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    store.remember(kind, key, { bounds, displayId: screen.getDisplayMatching(bounds).id, fullscreen: win.isFullScreen(), ...compactPlace(win) });
  };
  for (const event of ["resize", "move", "enter-full-screen", "leave-full-screen", "compact-changed"]) win.on(event, record);
  record();
}

function openSurfaceWindow({ appUrl, kind, key, params, store }) {
  const title = TITLES[kind] || "Telar";
  const { saved, bounds } = rememberedPlace(store, kind, key);
  const win = new BrowserWindow({
    ...bounds,
    minWidth: FULL_MIN.width,
    minHeight: FULL_MIN.height,
    show: false,
    title,
    ...backdropWindowOptions({ dark: nativeTheme.shouldUseDarkColors, supported: false }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      backgroundThrottling: false,
    },
  });
  applyExternalLinkPolicy(win.webContents, () => createExternalLinkPolicy({ appUrl }));
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(title);
  });
  win.once("ready-to-show", () => {
    win.show();
    if (saved?.fullscreen && !saved.compact) win.setFullScreen(true);
  });
  if (saved?.compact) setCompact(win, true, { place: false, expanded: saved.expanded ? placeOnDisplays({ bounds: saved.expanded }, screen.getAllDisplays(), screen.getPrimaryDisplay()) : null });
  if (store) trackPlace(win, store, kind, key);
  win.loadURL(surfaceUrl(appUrl, kind, params));
  return win;
}

function restoreBrowserWindows(manager, store) {
  for (const { key } of store.list("browser")) {
    try {
      manager.popOut(key);
    } catch {
      store.forget("browser", key);
    }
  }
}

module.exports = { openSurfaceWindow, restoreBrowserWindows };
