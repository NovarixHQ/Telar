const { beforeEach, describe, expect, test } = require("bun:test");
const { electron, resetElectron } = require("../../test/fake-electron");
const { grantee, openSettings, permissions, readFrontContext, requestPermissions } = require("./front-context");

const script = (out) => (_cmd, _args, _options, done) => done(null, JSON.stringify(out));

beforeEach(() => resetElectron());

describe("reading the app in front", () => {
  test("without the grant it still names the app, with no selection", async () => {
    const context = await readFrontContext({ runScript: script({ app: "Notes", title: "Plan", selection: "two lines" }) });
    expect(context).toEqual({ app: "Notes", title: "Plan", selection: "", permissions: { accessibility: false }, grantee: expect.any(String) });
  });

  test("with Accessibility it carries the selection", async () => {
    const context = await readFrontContext({ granted: { accessibility: true }, runScript: script({ app: "Notes", title: "Plan", selection: "two lines" }) });
    expect(context.selection).toBe("two lines");
  });

  test("a failed script leaves the composer with no context rather than failing", async () => {
    const context = await readFrontContext({ runScript: (_c, _a, _o, done) => done(new Error("timeout"), "") });
    expect(context).toMatchObject({ app: "", selection: "" });
  });
});

describe("the permission", () => {
  test("is read again on every call, so a grant made while Telar runs shows up", () => {
    expect(permissions()).toEqual({ accessibility: false });
    electron.systemPreferences.trusted = true;
    expect(permissions()).toEqual({ accessibility: true });
    expect(electron.systemPreferences.prompted).toBe(0);
  });

  test("off macOS there is no grant to ask for, so it counts as given", () => {
    const ask = electron.systemPreferences.isTrustedAccessibilityClient;
    delete electron.systemPreferences.isTrustedAccessibilityClient;
    try {
      expect(permissions()).toEqual({ accessibility: true });
      expect(() => requestPermissions()).not.toThrow();
    } finally {
      electron.systemPreferences.isTrustedAccessibilityClient = ask;
    }
  });

  test("opens the Accessibility pane, and nothing else", async () => {
    const opened = [];
    await openSettings("accessibility", (url) => opened.push(url));
    await openSettings("screen", (url) => opened.push(url));
    expect(opened).toEqual(["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]);
  });

  test("names the bundle System Settings lists it under", () => {
    expect(grantee("/Applications/Telar Dev.app/Contents/MacOS/Telar Dev")).toBe("Telar Dev");
    expect(grantee("/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")).toBe("Electron");
    expect(grantee("/usr/bin/telar")).toBe("Telar");
  });
});
