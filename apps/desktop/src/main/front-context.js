"use strict";

const { execFile } = require("node:child_process");
const { desktopCapturer, systemPreferences } = require("electron");

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

const SCREEN_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const ACCESSIBILITY_SETTINGS = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

function permissions() {
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen: systemPreferences.getMediaAccessStatus("screen") === "granted",
  };
}

async function requestPermissions() {
  systemPreferences.isTrustedAccessibilityClient(true);
  if (systemPreferences.getMediaAccessStatus("screen") === "not-determined") await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
}

function settingsFor(missing) {
  return missing.accessibility ? ACCESSIBILITY_SETTINGS : SCREEN_SETTINGS;
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

async function frontWindowShot(title, ownSourceIds) {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1600, height: 1000 } }).catch(() => []);
  const others = sources.filter((source) => !ownSourceIds.includes(source.id) && !source.thumbnail.isEmpty());
  const source = others.find((candidate) => title && candidate.name === title) ?? others[0];
  return source ? source.thumbnail.toDataURL() : null;
}

/** The front app, its window and its selection, each empty without its grant; macOS counts osascript as Telar. */
async function readFrontContext({ ownSourceIds = [], granted = permissions(), runScript } = {}) {
  const app = await frontApp(runScript);
  const screenshot = granted.screen ? await frontWindowShot(app?.title, ownSourceIds) : null;
  return {
    app: app?.app ?? "",
    title: app?.title ?? "",
    selection: granted.accessibility ? (app?.selection ?? "") : "",
    screenshot,
    permissions: granted,
  };
}

module.exports = { permissions, readFrontContext, requestPermissions, settingsFor };
