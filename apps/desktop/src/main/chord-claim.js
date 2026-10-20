"use strict";

const { execFile } = require("node:child_process");
const { quickComposerCommand } = require("./quick-composer-flag");

const PORTAL = { dest: "org.freedesktop.portal.Desktop", path: "/org/freedesktop/portal/desktop", iface: "org.freedesktop.portal.GlobalShortcuts" };
const PROBES = [
  ["gdbus", ["call", "--session", "--dest", PORTAL.dest, "--object-path", PORTAL.path, "--method", "org.freedesktop.DBus.Properties.Get", PORTAL.iface, "version"]],
  ["busctl", ["--user", "get-property", PORTAL.dest, PORTAL.path, PORTAL.iface, "version"]],
];

/** "portal" on native Wayland, where Electron binds global chords through the desktop portal; "direct" everywhere else, XWayland included. */
function chordRoute({ platform = process.platform, env = process.env, ozone = "" } = {}) {
  if (platform !== "linux" || ozone === "x11") return "direct";
  if (ozone === "wayland" || env.XDG_SESSION_TYPE === "wayland") return "portal";
  if (env.XDG_SESSION_TYPE === "x11") return "direct";
  return env.WAYLAND_DISPLAY ? "portal" : "direct";
}

function probe([command, args], run) {
  return new Promise((resolve) => {
    run(command, args, { timeout: 5000 }, (error) => resolve(error?.code === "ENOENT" ? null : !error));
  });
}

/** Whether the session bus offers the GlobalShortcuts portal; null when neither D-Bus tool is installed to ask. */
async function portalAvailable(run = execFile) {
  for (const each of PROBES) {
    const answer = await probe(each, run);
    if (answer !== null) return answer;
  }
  return null;
}

function claimOutcome({ chord, held, route, portal, command }) {
  const fallback = command ? { command } : {};
  if (route === "portal") return held && portal !== false ? { chord, outcome: "portal" } : { chord, outcome: "unavailable", reason: "desktop", ...fallback };
  return held ? { chord, outcome: "claimed" } : { chord, outcome: "unavailable", reason: "taken", ...fallback };
}

/** Turns a `globalShortcut.register` result into what Settings shows; the portal is asked about once. */
function createChordClaim({ route = chordRoute(), probePortal = portalAvailable, command = quickComposerCommand() } = {}) {
  let portal = null;
  return async (chord, held) => claimOutcome({ chord, held, route, portal: route === "portal" ? await (portal ??= probePortal()) : null, command });
}

module.exports = { chordRoute, createChordClaim, portalAvailable };
