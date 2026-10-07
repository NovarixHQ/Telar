const path = require("node:path");
const { BrowserWindow, nativeTheme } = require("electron");
const { createExternalLinkPolicy } = require("../browser/browser-manager");
const { backdropWindowOptions } = require("../main/window-material");
const { applyExternalLinkPolicy } = require("../main/window-links");

const TITLES = { browser: "Browser" };

function surfaceUrl(appUrl, kind, params) {
  const url = new URL(`/surface/${kind}`, appUrl);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.href;
}

function openSurfaceWindow({ appUrl, kind, params }) {
  const title = TITLES[kind] || "Telar";
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 360,
    minHeight: 240,
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
  win.once("ready-to-show", () => win.show());
  win.loadURL(surfaceUrl(appUrl, kind, params));
  return win;
}

module.exports = { openSurfaceWindow };
