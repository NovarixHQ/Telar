const { BrowserWindow, shell } = require("electron");
const { createLinkRouting } = require("./link-routing");
const { OVERLAY_FRAME, adoptOverlay } = require("../windows/overlay-layer");

const linkRouting = createLinkRouting();

function openInSystemBrowser(url) {
  shell.openExternal(url).catch((err) => {
    console.error("[telar-desktop] failed to open externally:", url, err?.message || err);
  });
}

function actOnLinkDecision(decision, webContents) {
  if (decision.openExternal) linkRouting.handOff(webContents, decision.openExternal, openInSystemBrowser);

  else if (decision.duplicateOf) {
    console.log("[telar-desktop] suppressed duplicate external open:", decision.duplicateOf);
  }
}

function overlayWindow(webContents, createPolicy) {
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win || win.webContents !== webContents) return null;
  return {
    action: "allow",
    createWindow: (options) => {
      const overlay = adoptOverlay(win, options);
      applyExternalLinkPolicy(overlay, createPolicy);
      return overlay;
    },
  };
}

function applyExternalLinkPolicy(webContents, createPolicy) {
  const policy = createPolicy();
  webContents.setWindowOpenHandler(({ url, frameName }) => {
    const overlay = frameName === OVERLAY_FRAME && url === "about:blank" ? overlayWindow(webContents, createPolicy) : null;
    if (overlay) return overlay;
    const decision = policy.decide(url);
    actOnLinkDecision(decision, webContents);
    return decision.action === "allow" ? { action: "allow" } : { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    const decision = policy.decide(url);
    if (decision.action === "allow") return;
    event.preventDefault();
    actOnLinkDecision(decision, webContents);
  });

  webContents.on("did-create-window", (childWindow) => {
    applyExternalLinkPolicy(childWindow.webContents, createPolicy);
  });
}

module.exports = { applyExternalLinkPolicy, linkRouting, openInSystemBrowser };
