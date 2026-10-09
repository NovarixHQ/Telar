"use strict";

const { execFile } = require("node:child_process");
const { app: electronApp, systemPreferences } = require("electron");

const FRONT_APP_SCRIPT = `
ObjC.import("AppKit");
ObjC.import("ApplicationServices");
function read(element, name) {
  if (!element) return null;
  const out = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), out) === 0 ? out[0] : null;
}
function text(ref) {
  if (!ref) return "";
  const value = ObjC.unwrap(ObjC.castRefToObject(ref));
  return typeof value === "string" ? value : "";
}
function run() {
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const out = { app: ObjC.unwrap(front.localizedName) || "", title: "", selection: "" };
  if (!$.AXIsProcessTrusted()) return JSON.stringify(out);
  const app = $.AXUIElementCreateApplication(front.processIdentifier);
  out.title = text(read(read(app, "AXFocusedWindow"), "AXTitle"));
  out.selection = text(read(read(app, "AXFocusedUIElement"), "AXSelectedText"));
  return JSON.stringify(out);
}`;

const ACCESSIBILITY_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

function permissions() {
  return { accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
}

function requestPermissions() {
  systemPreferences.isTrustedAccessibilityClient(true);
}

function openSettings(permission, open) {
  return permission === "accessibility" ? open(ACCESSIBILITY_SETTINGS) : undefined;
}

function grantee(execPath = process.execPath) {
  return /([^/]+)\.app\/Contents\/MacOS\//.exec(execPath)?.[1] ?? electronApp.getName();
}

function frontApp(run = execFile) {
  return new Promise((resolve) => {
    run("osascript", ["-l", "JavaScript", "-e", FRONT_APP_SCRIPT], { timeout: 1500 }, (error, stdout) => {
      try {
        resolve(error ? null : JSON.parse(String(stdout)));
      } catch {
        resolve(null);
      }
    });
  });
}

/** The front app, its window title and its selection, empty without the grant; macOS counts osascript as Telar. */
async function readFrontContext({ granted = permissions(), runScript } = {}) {
  const app = await frontApp(runScript);
  return {
    app: app?.app ?? "",
    title: app?.title ?? "",
    selection: granted.accessibility ? (app?.selection ?? "") : "",
    permissions: granted,
    grantee: grantee(),
  };
}

module.exports = { grantee, openSettings, permissions, readFrontContext, requestPermissions };
