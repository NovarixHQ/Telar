const { describe, expect, test } = require("bun:test");
const { chordRoute, createChordClaim, portalAvailable } = require("./chord-claim");

describe("which way a global chord is claimed", () => {
  test("macOS and Windows grab it directly", () => {
    expect(chordRoute({ platform: "darwin", env: { WAYLAND_DISPLAY: "wayland-0" } })).toBe("direct");
    expect(chordRoute({ platform: "win32", env: {} })).toBe("direct");
  });

  test("an X11 session grabs it directly", () => {
    expect(chordRoute({ platform: "linux", env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toBe("direct");
    expect(chordRoute({ platform: "linux", env: { DISPLAY: ":0" } })).toBe("direct");
  });

  test("a Wayland session asks the desktop portal", () => {
    expect(chordRoute({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } })).toBe("portal");
    expect(chordRoute({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } })).toBe("portal");
  });

  test("forcing XWayland grabs it directly, and forcing Wayland asks the portal", () => {
    expect(chordRoute({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }, ozone: "x11" })).toBe("direct");
    expect(chordRoute({ platform: "linux", env: { XDG_SESSION_TYPE: "x11" }, ozone: "wayland" })).toBe("portal");
  });
});

const runner = (answers) => {
  const asked = [];
  const run = (command, _args, _options, done) => {
    asked.push(command);
    const answer = answers[command];
    done(answer === "missing" ? Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) : answer === "error" ? Object.assign(new Error("No such interface"), { code: 1 }) : null);
  };
  return { asked, run };
};

describe("finding the GlobalShortcuts portal", () => {
  test("a portal that answers is there", async () => {
    const { asked, run } = runner({ gdbus: "ok" });
    expect(await portalAvailable(run)).toBe(true);
    expect(asked).toEqual(["gdbus"]);
  });

  test("a desktop without the interface has no portal", async () => {
    expect(await portalAvailable(runner({ gdbus: "error" }).run)).toBe(false);
  });

  test("without gdbus it asks busctl", async () => {
    const { asked, run } = runner({ gdbus: "missing", busctl: "ok" });
    expect(await portalAvailable(run)).toBe(true);
    expect(asked).toEqual(["gdbus", "busctl"]);
  });

  test("with neither tool it cannot tell", async () => {
    expect(await portalAvailable(runner({ gdbus: "missing", busctl: "missing" }).run)).toBeNull();
  });
});

describe("what Settings is told", () => {
  const command = "telar --quick-composer";

  test("a direct grab that held is claimed", async () => {
    expect(await createChordClaim({ route: "direct" })("Alt+Shift+Space", true)).toEqual({ chord: "Alt+Shift+Space", outcome: "claimed" });
  });

  test("a direct grab another app holds is taken, with the command to bind instead", async () => {
    expect(await createChordClaim({ route: "direct", command })("Alt+Shift+Space", false)).toEqual({ chord: "Alt+Shift+Space", outcome: "unavailable", reason: "taken", command });
    expect(await createChordClaim({ route: "direct", command: null })("Alt+Shift+Space", false)).toEqual({ chord: "Alt+Shift+Space", outcome: "unavailable", reason: "taken" });
  });

  test("on Wayland with a portal the desktop holds it", async () => {
    expect(await createChordClaim({ route: "portal", probePortal: async () => true, command })("Alt+Shift+Space", true)).toEqual({ chord: "Alt+Shift+Space", outcome: "portal" });
    expect(await createChordClaim({ route: "portal", probePortal: async () => null, command })("Alt+Shift+Space", true)).toEqual({ chord: "Alt+Shift+Space", outcome: "portal" });
  });

  test("on Wayland without a portal it is unavailable, with the command to bind instead", async () => {
    const outcome = { chord: "Alt+Shift+Space", outcome: "unavailable", reason: "desktop", command };
    expect(await createChordClaim({ route: "portal", probePortal: async () => false, command })("Alt+Shift+Space", true)).toEqual(outcome);
    expect(await createChordClaim({ route: "portal", probePortal: async () => true, command })("Alt+Shift+Space", false)).toEqual(outcome);
  });

  test("the portal is looked for once, however often the chord is rebound", async () => {
    let probes = 0;
    const claim = createChordClaim({ route: "portal", probePortal: async () => (probes += 1, true) });
    await claim("Alt+Shift+Space", true);
    await claim("Control+Alt+K", true);
    expect(probes).toBe(1);
  });

  test("a direct grab never looks for the portal", async () => {
    let probes = 0;
    await createChordClaim({ route: "direct", probePortal: async () => (probes += 1, true) })("Alt+Shift+Space", true);
    expect(probes).toBe(0);
  });
});
