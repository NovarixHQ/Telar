const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { app, BrowserWindow, dialog, ipcMain, net, Notification, powerMonitor, protocol, session } = require("electron");
const { DesktopBrowserManager, managerForScope } = require("../browser/browser-manager");
const { startBrowserControlServer } = require("../browser/browser-control-server");
const { createPreviewRenderer } = require("../agent-tools/preview-renderer");
const { publishTailscaleServe, serveEnv, unpublishTailscaleServe } = require("./tailscale");
const { windowTargetUrl } = require("./window-target");
const { createDesktopNotifier } = require("./desktop-notifications");
const { createChime } = require("./notification-sound");
const { readNotificationPrefs } = require("./notification-prefs");
const { watchVolumes } = require("./volume-watch");
const { awaitStore } = require("../store/store-gate");
const { createStoreGateWindow } = require("../store/store-gate-window");
const { createBrowserSuggestions } = require("../browser/browser-suggestions");
const { readProfileRegistry } = require("../browser/browser-profiles");
const { createSharedTabStore } = require("../browser/browser-tab-store");
const { createSitePermissionStore } = require("../browser/site-permissions");
const { bundledHelperDaemon, stopHelperDaemon } = require("./computer-use-stop");
const desktopHandoff = require("../handoff/desktop-handoff");
const { wireLoginOffer } = require("../login/login-offer-window");
const remoteFile = require("./remote-file");
const { findFreePort, getStablePort, storedPort, waitForCockpit } = require("./cockpit-origin");
const { APP_URL, registerCockpitScheme, serveCockpit, serveDevCockpit } = require("./cockpit-scheme");
const { migrateLegacyOrigin } = require("./origin-migration");
const { createRemoteHost } = require("./remote-host");
const { registerRemoteHostIpc } = require("./ipc-remote-host");
const { createSshHosts } = require("./ssh-hosts");
const engineNotices = require("./engine-notices").createEngineNotices({ onMessage: (message) => desktopNotifier.handleServerMessage(message) });
const { DEV_BUILD, E2E_USER_DATA, OVERRIDE_URL, SMOKE } = require("./flags");
const { applyDevelopmentAppIcon, bundledAgentSdkEntry, bundledPlaywrightMcpCli, buildInfoPath, computerUseHelperPath, cockpitDir, windowTitle } = require("./bundle-paths");
const { captureLoginShellEnv } = require("./login-shell-env");
const { findVolumeMount } = require("./volumes");
const { logShell, shellLogPath, startHeapLog } = require("./shell-log");
const { processMetricsReader, startServiceWorkerWatchdog } = require("./renderer-watch");
const { decideQuit, heldTerminals } = require("./terminal-quit");
const { engineDiscoveryFile, engineEndpoint, markMainWindowShown, postToEngine, rememberEngine, reportStartupFailure, requestEngine, startEngineChild, stopEngineChild, waitForEngine } = require("./engine-child");
const { createQuitGate } = require("./quit-gate");
const { keepOccludedWindowsPainting, watchSchemeForVibrancy } = require("./appearance");
const { buildApplicationMenu, followFocusedWindow, readKeybindingOverrides } = require("./app-menu");
const { startExtensionHost } = require("./cockpit-extensions");
const { passwordManagerEnabled } = require("../login/password-manager-prefs");
const { adoptLegacyUpdatePrefs } = require("./update-prefs");
const { browserManagers, currentHost, lastWindowUrl, persistAllHosts } = require("./browser-hosts");
const { createCockpitWindow, setClientOnly } = require("./cockpit-window");
const { cockpitFocus } = require("./cockpit-focus");
const { pinUserData } = require("./user-data");
const { openSurfaceWindow, restoreBrowserWindows } = require("../windows/surface-window");
const { mainWindow, windowToFocus } = require("../windows/main-window");
const { createSurfaceWindowStore } = require("../windows/surface-window-store");
const { isCompact, setCompact } = require("../windows/compact-window");
const { registerDevPairing } = require("../dev/pair-simulators");
const { createQuickComposer } = require("./quick-composer");
const { mergeKeymap } = require("./command-keys");

pinUserData();

let surfaceWindows;
function requireSurfaceWindows() {
  return surfaceWindows ||= createSurfaceWindowStore(app.getPath("userData"));
}

let browserTabs;
function requireBrowserTabs() {
  return browserTabs ||= createSharedTabStore(app.getPath("userData"));
}

let browserSuggestions;
function requireBrowserSuggestions() {
  return browserSuggestions ||= createBrowserSuggestions(app.getPath("userData"));
}
let quickComposer = null;
let browserControl = null;
let previewRenderer = null;
let browserControlConfig = null;

if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform-hint", "auto");

const REMOTE_DEBUGGING_PORT = process.env.TELAR_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
if (REMOTE_DEBUGGING_PORT && /^\d+$/.test(REMOTE_DEBUGGING_PORT)) {
  app.commandLine.appendSwitch("remote-debugging-port", REMOTE_DEBUGGING_PORT);

  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

let smokeHome = null;

let resolvedStoreHome = null;
function telarHome() {
  if (SMOKE) {
    smokeHome ??= fs.mkdtempSync(path.join(os.tmpdir(), "telar-smoke-"));
    return smokeHome;
  }
  if (resolvedStoreHome) return resolvedStoreHome;

  if (DEV_BUILD) return app.getPath("userData");
  return process.env.TELAR_HOME?.trim() || app.getPath("userData");
}

let storeGate = null;
let migratingOrigin = false;
async function openStoreGate() {
  const explicit = DEV_BUILD ? "" : process.env.TELAR_HOME?.trim();
  if (explicit) return explicit;
  storeGate = createStoreGateWindow();

  const watcher = watchVolumes({ onChanged: () => storeGate.volumesChanged(), powerMonitor });
  try {
    const settled = await awaitStore(
      { userData: app.getPath("userData"), defaultRoot: app.getPath("userData") },
      { present: (outcome) => storeGate.present(outcome), findVolumeMount },
    );
    return settled.quit ? null : settled.root;
  } finally {
    watcher.stop();
    storeGate.close();
    storeGate = null;
  }
}

function wireShellDiagnostics() {
  app.on("child-process-gone", (_event, details) => {
    logShell(
      "warn",
      `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} service=${details.serviceName ?? ""}`,
    );
  });
}

function childEnv(home) {
  const computerUseHelper = computerUseHelperPath();
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    TELAR_HOME: home,
    ...(computerUseHelper ? { TELAR_COMPUTER_USE_HELPER: computerUseHelper } : {}),
    ...(browserControlConfig
      ? {
          TELAR_DESKTOP_BROWSER_CONTROL_PORT: String(browserControlConfig.port),
          TELAR_DESKTOP_BROWSER_CONTROL_TOKEN: browserControlConfig.token,
        }
      : {}),
  };
}

function cockpitEnv(home, port) {
  return {
    ...childEnv(home),
    TELAR_ENGINE_HOST: remoteFile.serverBindHost(home),
    TELAR_ENGINE_PORT: String(port),
    TELAR_STATIC_DIR: cockpitDir(),
    TELAR_BUILD_INFO: buildInfoPath(),
    TELAR_HOST_CLIENT: app.getName(),
    ...serveEnv(),
  };
}

const chime = createChime({ packaged: app.isPackaged });
const desktopNotifier = createDesktopNotifier({
  Notification,
  send: engineNotices.send,
  context: cockpitFocus,
  open: openNotificationPath,
  chime,
  enabled: () => readNotificationPrefs().enabled,
});

function openNotificationPath(route) {
  const win = [currentHost(), ...browserManagers].map((manager) => manager?.window).find((w) => w && !w.isDestroyed());
  if (!win) {
    const target = windowTargetUrl(lastWindowUrl(), route);
    if (target) createWindow(target);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send("telar:notifications:open", route);
}

function createWindow(url, { main = false } = {}) {
  return createCockpitWindow(url, {
    main,
    createManager: (win, { onChordScope, forwardPageCommand }) => {
      const manager = new DesktopBrowserManager(win, {
        onControlChanged: reportBrowserControl,

        onLoginEntryFinished: (capture) => requireLoginOffer().entryFinished(capture),

        onVisited: (scopeKey, url) => requireBrowserSuggestions().remember(manager.activeProfile(scopeKey)?.id, url),
        onTitled: (scopeKey, url, title) => requireBrowserSuggestions().retitle(manager.activeProfile(scopeKey)?.id, url, title),
        profiles: readProfileRegistry(app.getPath("userData")),

        onProfileMigrated: (from, to) => requireBrowserSuggestions().adopt(from, to),

        tabStore: requireBrowserTabs().forWindow(),

        sitePermissions: createSitePermissionStore(app.getPath("userData")),

        createExtensionHost: (partition) => startExtensionHost(win, manager, partition),

        openStageWindow: (scope, { project }) =>
          openSurfaceWindow({ appUrl: url, kind: "browser", key: scope, params: { scope, project }, store: requireSurfaceWindows() }),

        onStageClosed: (scope) => requireSurfaceWindows().forget("browser", scope),

        compactStageWindow: (stageWindow, on) => setCompact(stageWindow, on),
        stageWindowCompact: isCompact,

        onChordScope,
        forwardPageCommand,
      });
      return manager;
    },
  });
}

let loginOffer = null;
function requireLoginOffer() {
  loginOffer ??= wireLoginOffer({ stateRoot: path.join(telarHome(), "engine") });
  return loginOffer;
}

function reportBrowserControl(change) {
  postToEngine(telarHome(), `/v2/sessions/${encodeURIComponent(change.scopeKey)}/browser/control`, {
    controller: change.controller,
    ...(change.tabId ? { tabId: change.tabId } : {}),
    ...(change.interrupted ? { interrupted: true } : {}),
  });
}

function reportVolumesChanged() {
  postToEngine(telarHome(), "/v2/projects/reprobe");
}

let updaterWindow = null;

function stopComputerUseHelper() {
  const helperApp = computerUseHelperPath();
  if (!helperApp) return;
  try {
    stopHelperDaemon(bundledHelperDaemon(helperApp));
  } catch (error) {
    console.error("[telar-desktop] could not stop the computer-use helper:", error);
  }
}
function closeBrowserControl() {
  const control = browserControl;
  browserControl = null;
  if (control) void control.close();
}

function confirmQuit(options, signal) {
  app.focus({ steal: true });
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return parent ? dialog.showMessageBox(parent, { ...options, signal }) : dialog.showMessageBox({ ...options, signal });
}

const quitGate = createQuitGate({
  ask: () => Promise.all([
    requestEngine(telarHome(), "GET", "/v2/sessions/working").then((body) => body.count),
    requestEngine(telarHome(), "GET", "/v2/session-defaults").then((body) => body.sessionDefaults),
  ]),
  confirm: confirmQuit,
  save: (patch) => requestEngine(telarHome(), "PATCH", "/v2/session-defaults", patch),
  bypass: () => app.isQuitting === true || SMOKE || Boolean(E2E_USER_DATA),
  onCancel: () => requireSurfaceWindows().release(),
  power: powerMonitor,
});

let terminalsClosedForQuit = false;
let closingTerminalsForQuit = false;
app.on("before-quit", (event) => {
  if (quitGate.hold(event, () => app.quit())) return;
  if (terminalsClosedForQuit) return;
  event.preventDefault();
  if (closingTerminalsForQuit) return;
  closingTerminalsForQuit = true;
  void askBeforeEndingTerminals();
});
app.on("before-quit", () => requireSurfaceWindows().holdForQuit());

async function askBeforeEndingTerminals() {
  try {
    const plan = decideQuit(await heldTerminals(telarHome()));
    if (plan.action === "confirm" && !SMOKE && !E2E_USER_DATA && !quitGate.systemEnding()) {
      const { response } = await confirmQuit(plan.dialog);
      if (response !== plan.dialog.defaultId) {
        closingTerminalsForQuit = false;
        app.isQuitting = false;
        quitGate.reset();
        requireSurfaceWindows().release();
        return;
      }
    }
  } catch (error) {
    logShell("error", `asking about terminals before quit failed: ${error?.stack || error}`);
  }
  terminalsClosedForQuit = true;
  app.quit();
}

app.on("will-quit", (event) => {
  app.isQuitting = true;
  persistAllHosts();

  const engineStopped = stopEngineChild({ quit: true });
  stopComputerUseHelper();
  sshHosts.stopAll();
  closeBrowserControl();

  const unpublished = unpublishTailscaleServe();
  event.preventDefault();
  void Promise.allSettled([engineStopped, unpublished]).finally(() => app.exit(0));
});

process.on("exit", () => stopEngineChild());
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopEngineChild();
    stopComputerUseHelper();
    sshHosts.stopAll();
    process.exit(0);
  });
}

async function recordHandoffBoot(home) {
  if (!app.isPackaged || DEV_BUILD) return;
  try {
    if (desktopHandoff.awaitingConfirmation()) await waitForEngine(home, { requireWorker: true });
    desktopHandoff.recordBoot((line) => logShell("info", line));
  } catch (err) {
    logShell("error", `hand-off boot check failed: ${err?.message || err}`);
  }
}

async function runSmoke() {
  try {
    let port;
    if (OVERRIDE_URL) {
      const u = new URL(OVERRIDE_URL);
      port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    } else {
      captureLoginShellEnv();
      const home = telarHome();
      port = await findFreePort();
      startEngineChild(home, cockpitEnv(home, port));

      const discovery = await waitForEngine(home, { requireWorker: true });
      rememberEngine(discovery);
      console.log("ENGINE_OK");
      console.log(`ENGINE_WORKER_OK ${discovery.workerId}`);
    }
    await waitForCockpit(port);
    console.log(`BUILD ${windowTitle()}`);
    console.log("SMOKE_OK");

    const cli = bundledPlaywrightMcpCli();
    if (fs.existsSync(cli)) {
      console.log("PLAYWRIGHT_MCP_BUNDLED_OK");
    } else {
      console.error("PLAYWRIGHT_MCP_BUNDLED_MISSING:", cli);
      if (app.isPackaged) {
        app.isQuitting = true;
        stopEngineChild();
        app.exit(1);
        return;
      }
    }

    const sdk = bundledAgentSdkEntry();
    if (fs.existsSync(sdk)) {
      console.log("AGENT_SDK_BUNDLED_OK");
    } else {
      console.error("AGENT_SDK_BUNDLED_MISSING:", sdk);
      if (app.isPackaged) {
        app.isQuitting = true;
        stopEngineChild();
        app.exit(1);
        return;
      }
    }
    app.isQuitting = true;
    stopEngineChild();
    app.exit(0);
  } catch (err) {
    console.error("SMOKE_FAIL:", err && err.message ? err.message : err);
    app.isQuitting = true;
    stopEngineChild();
    app.exit(1);
  }
}

require("./ipc-browser").registerBrowserIpc({ requireBrowserSuggestions, requireLoginOffer });

require("./ipc-store").registerWorkspaceAndStoreIpc({ telarHome });

require("./ipc-prefs").registerPrefsIpc({
  onKeymap: (keymap) => quickComposer?.bind(keymap["quick-composer"]),
  onCapture: (capturing) => quickComposer?.suspend(capturing),
});

require("./ipc-app").registerAppIpc({ createWindow });

const remoteHost = createRemoteHost({ dir: app.getPath("userData") });
const sshHosts = createSshHosts({
  dir: app.getPath("userData"),
  base: () => process.env.TELAR_DOWNLOAD_BASE?.trim(),
  findFreePort,
  log: (line) => logShell("info", line),
});
registerRemoteHostIpc({ remoteHost, sshHosts });

require("../windows/overlay-layer").registerOverlayIpc();

const { configureAutoUpdater } = require("./updates").registerUpdates({
  telarHome,
  get updaterWindow() {
    return updaterWindow;
  },
  get terminalsClosedForQuit() {
    return terminalsClosedForQuit;
  },
  set terminalsClosedForQuit(value) {
    terminalsClosedForQuit = value;
  },
});

registerCockpitScheme(protocol);

keepOccludedWindowsPainting();

if (SMOKE) {
  app.on("window-all-closed", () => {});
  app.whenReady().then(runSmoke);
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.error(
      `[telar-desktop] another instance already holds the lock for ${app.getPath("userData")} — focusing it and quitting.`,
    );
    app.quit();
  } else {
    app.on("second-instance", (_event, argv) => {
      const deepLink = argv.find((arg) => arg.startsWith("telar://app/"));
      if (deepLink) return openNotificationPath(new URL(deepLink).pathname);
      const win = windowToFocus(mainWindow(), [...browserManagers].map((manager) => manager.window));
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });

    app.whenReady().then(async () => {
      try {
        wireShellDiagnostics();
        chime.install({ from: process.resourcesPath, home: os.homedir(), log: (line) => logShell("warn", line) });

        startHeapLog(() => currentHost()?.diagnostics() ?? null);

        startServiceWorkerWatchdog(browserManagers);
        applyDevelopmentAppIcon();
        buildApplicationMenu();
        followFocusedWindow();

        watchSchemeForVibrancy();

        adoptLegacyUpdatePrefs();

        const configuredControlPort = DEV_BUILD ? NaN : Number(process.env.TELAR_DESKTOP_BROWSER_CONTROL_PORT);
        browserControlConfig = {
          port: Number.isInteger(configuredControlPort) && configuredControlPort > 0
            ? configuredControlPort
            : await findFreePort(),
          token: (DEV_BUILD ? undefined : process.env.TELAR_DESKTOP_BROWSER_CONTROL_TOKEN?.trim()) || randomUUID(),
        };
        browserControl = await startBrowserControlServer({
          ...browserControlConfig,

          getBrowserManager: (scopeKey) => managerForScope(browserManagers, scopeKey, currentHost()),

          readProcessMetrics: () => processMetricsReader().summary(),

          passwordManagerEnabled,

          renderPreview: (input) => (previewRenderer ||= createPreviewRenderer({ BrowserWindow, session })).render(input),
        });

        let url = OVERRIDE_URL;
        sshHosts.restore();
        powerMonitor.on("resume", sshHosts.reconnectAll);
        const clientOnly = !url && Boolean(remoteHost.endpoint());
        setClientOnly(clientOnly);
        if (clientOnly) {
          serveCockpit(session.defaultSession, { net, staticDir: cockpitDir(), engine: remoteHost.endpoint });
          url = APP_URL;
        } else if (url) {
          const home = telarHome();
          serveDevCockpit(session.defaultSession, { net, origin: new URL(url).origin, engine: () => engineEndpoint(home) });
        } else {
          captureLoginShellEnv();

          resolvedStoreHome = await openStoreGate();
          if (resolvedStoreHome === null) {
            app.quit();
            return;
          }

          const home = telarHome();
          const legacyOrigin = process.platform === "darwin";
          const legacyPort = legacyOrigin ? storedPort() : null;
          const port = legacyOrigin ? await getStablePort() : await findFreePort();
          startEngineChild(home, cockpitEnv(home, port));
          rememberEngine(await waitForEngine(home));
          await recordHandoffBoot(home);
          await publishTailscaleServe(home, port);
          engineNotices.start(engineDiscoveryFile(home));
          await waitForCockpit(port);
          serveCockpit(session.defaultSession, { net, staticDir: cockpitDir(), engine: () => engineEndpoint(home) });
          if (legacyOrigin) {
            migratingOrigin = true;
            await migrateLegacyOrigin({
              legacyPort,
              listeningPort: port,
              appUrl: APP_URL,
              createWindow: () => new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }),
              log: (line) => logShell("info", line),
            });
          }
          url = APP_URL;
          const notify = (body) => new Notification({ title: "Pair Booted Simulators", body }).show();
          if (registerDevPairing({ dev: DEV_BUILD, port, endpoint: () => engineEndpoint(home), ipcMain, notify })) buildApplicationMenu();
        }
        updaterWindow = createWindow(url, { main: true });
        migratingOrigin = false;
        if (process.platform === "darwin") {
          quickComposer = createQuickComposer({ appUrl: url, openRoute: openNotificationPath, log: (line) => logShell("warn", line) });
          quickComposer.bind(mergeKeymap(readKeybindingOverrides())["quick-composer"]);
        }
        restoreBrowserWindows(currentHost(), requireSurfaceWindows());

        markMainWindowShown();
        configureAutoUpdater();

        watchVolumes({ onChanged: reportVolumesChanged, powerMonitor });
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow(url, { main: true });
        });
      } catch (err) {
        logShell("error", `failed to start: ${err?.stack || err}`);
        reportStartupFailure(
          "Telar could not start",
          `${err?.message || err}\n\nThere is more in ${shellLogPath()}.`,
        );
        app.quit();
      }
    });

    app.on("window-all-closed", () => {
      if (migratingOrigin) return;
      app.isQuitting = true;
      app.quit();
    });
  }
}
