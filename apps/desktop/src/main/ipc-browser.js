const { ipcMain, BrowserWindow, shell } = require("electron");
const { externalOpenTarget } = require("../browser/browser-manager");
const { ONE_PASSWORD } = require("../browser/extension-host");
const { readLoginOfferPrefs, writeLoginOfferPrefs } = require("../login/login-offer-prefs");
const { passwordManagerEnabled, setPasswordManagerEnabled } = require("../login/password-manager-prefs");
const { browserManagers, requireBrowserManager, requireCockpitSender } = require("./browser-hosts");
const { openInSystemBrowser } = require("./window-links");

const PASSWORD_MANAGER_OFF = "The password manager is turned off in Settings → Integrations.";

function registerViewIpc({ requireBrowserSuggestions }) {
  ipcMain.handle("telar:browser:suggestions", async (event, scopeKey) => {
    const manager = requireBrowserManager(event);
    manager.partitionOf(scopeKey);
    const ownPort = Number(new URL(manager.window.webContents.getURL()).port);
    return requireBrowserSuggestions().list(manager.activeProfile(scopeKey)?.id, [
      ownPort,
      Number(process.env.TELAR_DESKTOP_REMOTE_DEBUGGING_PORT),
      Number(process.env.TELAR_DESKTOP_BROWSER_CONTROL_PORT),
    ]);
  });

  ipcMain.handle("telar:browser:remove-suggestion", (event, input) => {
    const manager = requireBrowserManager(event);
    manager.partitionOf(input?.scopeKey);
    requireBrowserSuggestions().remove(manager.activeProfile(input.scopeKey)?.id, input.url);
  });

  ipcMain.handle("telar:browser:state", (event, scopeKey) => requireBrowserManager(event).state(scopeKey, event.sender));

  ipcMain.handle("telar:browser:extension-status", (event, scopeKey) => {
    const manager = requireBrowserManager(event);
    if (!passwordManagerEnabled()) return { phase: "unavailable", off: true };
    const host = manager.hostForScope(scopeKey);
    if (!host) return { phase: "unavailable", error: "Extensions are not enabled, or this session has no project profile yet." };

    let partition; try { partition = manager.partitionOf(scopeKey); } catch { partition = undefined; }
    return { ...(partition ? { partition } : {}), ...host.status() };
  });

  ipcMain.handle("telar:browser:extension-popup", async (event, input) => {
    const manager = requireBrowserManager(event);
    if (!passwordManagerEnabled()) throw new Error(PASSWORD_MANAGER_OFF);
    const host = manager.hostForScope(input?.scopeKey);
    if (!host) throw new Error("Extensions are not enabled, or this session has no project profile yet.");
    const tab = manager.activeTab(input?.scopeKey, manager.stageOfSender(input?.scopeKey, event.sender));
    await manager.wakeTab(tab);
    const win = BrowserWindow.fromWebContents(event.sender);
    return host.openPopup(win, tab.view.webContents, input?.anchorRect || { x: 0, y: 0, width: 24, height: 24 });
  });

}

function registerProfileIpc({ requireLoginOffer }) {
  ipcMain.handle("telar:browser:bind-profile", (event, input) =>
    requireBrowserManager(event).declareProfile(input?.scopeKey, input?.profileKey),
  );

  ipcMain.handle("telar:browser:profiles", (event, scopeKey) => {
    const manager = requireBrowserManager(event);
    return {
      profiles: manager.listProfiles(),
      active: scopeKey ? manager.activeProfile(scopeKey) : null,
      projectKey: scopeKey ? manager.profileOf(scopeKey) : null,
    };
  });

  ipcMain.handle("telar:browser:create-profile", async (event, input) => {
    const manager = requireBrowserManager(event);
    const profile = manager.profiles.create({ label: input?.label, account: input?.account, icon: input?.icon, color: input?.color });

    if (input?.scopeKey) await manager.setScopeProfile(input.scopeKey, profile.id);
    if (input?.scopeKey && input?.assignProject) {
      const projectKey = manager.profileOf(input.scopeKey);
      if (projectKey) manager.assignProjectProfile(projectKey, profile.id);
    }

    manager.emitAllStates();
    return { profiles: manager.listProfiles(), active: profile };
  });

  ipcMain.handle("telar:browser:update-profile", (event, input) => {
    const manager = requireBrowserManager(event);

    const profile = manager.profiles.update(input?.profileId, {
      ...(input?.label !== undefined ? { label: input.label } : {}),
      ...(input?.account !== undefined ? { account: input.account } : {}),
      ...(input?.icon !== undefined ? { icon: input.icon } : {}),
      ...(input?.color !== undefined ? { color: input.color } : {}),
    });
    manager.emitAllStates();
    return { profiles: manager.listProfiles(), active: profile };
  });

  ipcMain.handle("telar:browser:delete-profile", (event, input) => {
    const manager = requireBrowserManager(event);

    const removed = manager.deleteProfile(input?.profileId);
    manager.emitAllStates();
    return { profiles: manager.listProfiles(), removed };
  });

  ipcMain.handle("telar:browser:clear-profile-data", async (event, input) => {
    const manager = requireCockpitSender(event, "clear a browser profile's data");
    await manager.clearProfileData(input?.profileId);
    return { profiles: manager.listProfiles() };
  });

  ipcMain.handle("telar:browser:forget-profile-logins", async (event, input) => {
    const manager = requireCockpitSender(event, "forget a browser profile's logins");
    manager.profiles.require(input?.profileId);
    await requireLoginOffer().forgetProfile(input.profileId);
    return { profiles: manager.listProfiles() };
  });

  ipcMain.handle("telar:browser:set-default-profile", (event, input) => {
    const manager = requireBrowserManager(event);
    manager.profiles.setDefault(input?.profileId);
    manager.emitAllStates();
    return { profiles: manager.listProfiles() };
  });

  ipcMain.handle("telar:browser:assign-project-profile", (event, input) => {
    const manager = requireBrowserManager(event);
    const projectKey = input?.projectKey || manager.profileOf(input?.scopeKey);
    if (!projectKey) throw new Error("This session has no project to assign a browser profile to.");
    manager.assignProjectProfile(projectKey, input?.profileId ?? null);
    manager.emitAllStates();
    return { profiles: manager.listProfiles() };
  });

  ipcMain.handle("telar:browser:set-scope-profile", (event, input) =>
    requireBrowserManager(event).setScopeProfile(input?.scopeKey, input?.profileId),
  );

  ipcMain.handle("telar:browser:permission-answer", (event, input) =>
    requireCockpitSender(event, "answer a site permission prompt").answerSitePermission(input?.requestId, {
      decision: input?.decision,
      ...(input?.sourceId ? { sourceId: input.sourceId } : {}),
    }),
  );

  ipcMain.handle("telar:browser:permission-prompts", (event, scopeKey) => ({
    prompts: requireBrowserManager(event).pendingPermissionPrompts(scopeKey || undefined),
  }));

  ipcMain.handle("telar:browser:site-permissions", (event, input) =>
    requireBrowserManager(event).scopeSitePermissions(input?.scopeKey, input?.origin),
  );

  ipcMain.handle("telar:browser:forget-site-permission", (event, input) =>
    requireCockpitSender(event, "change a site permission").forgetSitePermission({
      scopeKey: input?.scopeKey,
      origin: input?.origin,
      ...(input?.kind ? { kind: input.kind } : {}),
    }),
  );

}

function registerTabIpc({ requireLoginOffer }) {
  ipcMain.handle("telar:browser:action", (event, input) =>
    requireBrowserManager(event).action(input?.scopeKey, input?.action, event.sender),
  );

  ipcMain.handle("telar:browser:open-external", (event, input) => {
    requireCockpitSender(event, "open a page in the system browser");
    const target = externalOpenTarget(input?.url);
    if (!target) return { ok: false, error: "Only http and https pages open in the system browser." };
    openInSystemBrowser(target);
    return { ok: true };
  });

  ipcMain.handle("telar:browser:open-password-manager", async (event) => {
    requireCockpitSender(event, "open the password manager app");
    try {
      await shell.openExternal(ONE_PASSWORD.browserSettingsUrl);
      return { ok: true };
    } catch {
      return { ok: false, error: `${ONE_PASSWORD.name} is not installed.` };
    }
  });

  ipcMain.handle("telar:browser:password-manager", (event, patch) => {
    requireCockpitSender(event, "turn the password manager on or off");
    if (typeof patch?.enabled === "boolean") setPasswordManagerEnabled(patch.enabled);
    return { enabled: passwordManagerEnabled() };
  });

  ipcMain.handle("telar:login-offer:prefs", (event, patch) => {
    requireCockpitSender(event, "change when Telar offers to remember a login");
    if (typeof patch?.offerAfterSignIn === "boolean") writeLoginOfferPrefs({ offerAfterSignIn: patch.offerAfterSignIn });
    return readLoginOfferPrefs();
  });

  ipcMain.handle("telar:browser:clear-data", (event, input) => {
    const manager = requireCockpitSender(event, "clear this browser's cookies or cache");
    return manager.clearBrowsingData(input?.scopeKey, input?.kind);
  });

  ipcMain.handle("telar:browser:capture", (event, input) => {
    const manager = requireCockpitSender(event, "capture this browser");
    return manager.capture(input?.scopeKey, {
      fullPage: Boolean(input?.fullPage),
      elements: Boolean(input?.elements),
    }, event.sender);
  });

  ipcMain.handle("telar:browser:save-screenshot", (event, input) =>
    requireCockpitSender(event, "save a screenshot of this browser").saveScreenshot(input?.scopeKey, { fullPage: Boolean(input?.fullPage) }),
  );

  ipcMain.handle("telar:browser:copy-screenshot", (event, input) =>
    requireCockpitSender(event, "copy a browser screenshot").copyScreenshot(input?.path),
  );

  ipcMain.handle("telar:browser:tool", (event, input) =>
    requireBrowserManager(event).callTool(input?.scopeKey, input?.name, input?.args || {}),
  );

  ipcMain.on("telar:browser:set-bounds", (event, input) => {
    try {
      requireBrowserManager(event).setBounds(input?.scopeKey, input?.bounds, event.sender);
    } catch {
    }
  });

  ipcMain.handle("telar:browser:set-visible", (event, input) =>
    requireBrowserManager(event).setVisible(input?.scopeKey, input?.visible, event.sender),
  );

  ipcMain.handle("telar:browser:freeze-view", (event, input) =>
    requireBrowserManager(event).freezeView(input?.scopeKey, event.sender),
  );

  ipcMain.handle("telar:browser:release-scope", (event, input) =>
    requireBrowserManager(event).releaseScope(input?.scopeKey, Boolean(input?.destroy), {
      closedByPerson: Boolean(input?.closedByPerson),
    }),
  );

  ipcMain.handle("telar:browser:adopt-scope", (event, input) =>
    requireBrowserManager(event).adoptScope(input?.fromScopeKey, input?.toScopeKey),
  );

  ipcMain.handle("telar:login-offer:open", (event, scopeKey) => {
    const manager = requireCockpitSender(event, "open the login offer");
    if (!passwordManagerEnabled()) return { ok: false, error: PASSWORD_MANAGER_OFF };
    const capture = manager.loginCaptureForScope(scopeKey);
    if (!capture) return { ok: false, error: "This page cannot carry a remembered login (open an http(s) page first)." };
    return requireLoginOffer().explicitOffer(capture);
  });

  ipcMain.on("telar:browser:login-entry", (event, detail) => {
    try {
      for (const manager of browserManagers) manager.noteLoginEntryFromWebContents(event.sender, detail || {});
    } catch {
    }
  });

  ipcMain.on("telar:browser:human-input", (event) => {
    try {
      for (const manager of browserManagers) manager.noteHumanInputFromWebContents(event.sender);
    } catch {
    }
  });
}

function registerBrowserIpc(deps) {
  registerViewIpc(deps);
  registerProfileIpc(deps);
  registerTabIpc(deps);
}

module.exports = { registerBrowserIpc };
