const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { BrowserWindow, nativeTheme } = require("electron");
const { createExternalLinkPolicy } = require("../browser/browser-manager");
const { macWindowChrome } = require("./window-chrome");
const { backdropWindowOptions } = require("./window-material");
const { watchWindowVisibility } = require("./window-visibility");
const { seatHostCookie, seatHostHeader } = require("./ui-server");
const { developmentIconPath, windowTitle } = require("./bundle-paths");
const { watchForUnpairing } = require("./shell-log");
const { readUiPrefs, supportsTranslucency } = require("./appearance");
const { forgetBrowserChordScope, setBrowserChordScope } = require("./app-menu");
const { applyExternalLinkPolicy, linkRouting } = require("./window-links");
const { addHost, rememberWindowUrl, removeHost } = require("./browser-hosts");
const { passwordManagerEnabled } = require("../login/password-manager-prefs");
const { DEV_BUILD, DEV_BUILD_ARG } = require("./flags");
const { adoptMainWindow, windowPlace } = require("../windows/main-window");

function cockpitWindowOptions(title) {
  const icon = developmentIconPath();
  return {
    ...backdropWindowOptions({ ...readUiPrefs(), dark: nativeTheme.shouldUseDarkColors, supported: supportsTranslucency() }),
    show: false,
    title,
    ...macWindowChrome(),
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      ...(DEV_BUILD ? { additionalArguments: [DEV_BUILD_ARG] } : {}),

      plugins: true,

      backgroundThrottling: false,
    },
  };
}

function onCockpitReload(win, manager) {
  manager.hideVisibleScope();

  linkRouting.set(win.webContents, false);
}

function retryFailedLoads(win, url) {
  let retryTimer = null;
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || win.isDestroyed()) return;
    console.error(`[telar-desktop] load failed (${errorCode} ${errorDescription}): ${failedUrl} — retrying`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.loadURL(url);
    }, 1_000);
  });
  win.on("closed", () => clearTimeout(retryTimer));
}

const MAIN_WINDOW_ID = "main";
const openWindowIds = new Set();

function claimWindowUrl(appUrl) {
  const id = openWindowIds.has(MAIN_WINDOW_ID) ? randomUUID() : MAIN_WINDOW_ID;
  openWindowIds.add(id);
  const url = new URL(appUrl);
  url.searchParams.set("w", id);
  return { id, url: url.href };
}

function createCockpitWindow(appUrl, { createManager, onInPageNavigation, main = false }) {
  const title = windowTitle();
  rememberWindowUrl(appUrl);
  const { id, url } = claimWindowUrl(appUrl);

  const place = windowPlace(main);
  const win = new BrowserWindow({ ...cockpitWindowOptions(title), ...place.bounds });
  if (main) adoptMainWindow(win, place);
  watchWindowVisibility(win);

  const manager = createManager(win, { onChordScope: (owned) => setBrowserChordScope(manager, owned) });
  addHost(win, manager);

  applyExternalLinkPolicy(win.webContents, () => createExternalLinkPolicy({ appUrl }));
  win.webContents.on("did-start-loading", () => onCockpitReload(win, manager));
  win.webContents.on("did-navigate-in-page", () => onInPageNavigation());
  win.webContents.on("did-finish-load", () => {
    if (win.isDestroyed()) return;

    if (!passwordManagerEnabled()) return;
    for (const [partition, host] of manager.extensionHosts) win.webContents.send("telar:browser:extension", { partition, ...host.status() });
  });
  win.on("closed", () => {
    openWindowIds.delete(id);
    manager.destroy();
    removeHost(manager);

    forgetBrowserChordScope(manager);
  });

  win.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle(title);
  });

  watchForUnpairing(win.webContents);
  retryFailedLoads(win, url);

  win.once("ready-to-show", () => win.show());
  win.setTitle(title);

  seatHostHeader(appUrl);
  seatHostCookie(appUrl).finally(() => {
    if (!win.isDestroyed()) win.loadURL(url);
  });
  return win;
}

module.exports = { cockpitWindowOptions, createCockpitWindow };
