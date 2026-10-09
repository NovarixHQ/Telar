const { beforeEach, describe, expect, test } = require("bun:test");
const { electron, resetElectron } = require("../../test/fake-electron");
const { grantee, permissions, readFrontContext, settingsFor } = require("./front-context");

const script = (out) => (_cmd, _args, _options, done) => done(null, JSON.stringify(out));
const source = (id, name, png) => ({ id, name, thumbnail: { isEmpty: () => false, toDataURL: () => png } });

beforeEach(() => resetElectron());

describe("reading the app in front", () => {
  test("without permissions it still names the app, with nothing attached", async () => {
    electron.desktopCapturer.sources = [source("window:9:0", "Plan", "data:image/png;base64,AA==")];
    const context = await readFrontContext({ runScript: script({ app: "Notes", title: "", selection: "" }) });
    expect(context).toEqual({ app: "Notes", title: "", selection: "", screenshot: null, permissions: { accessibility: false, screen: false }, grantee: expect.any(String) });
  });

  test("with both grants it attaches the front window, skipping Telar's own, and the selection", async () => {
    electron.desktopCapturer.sources = [
      source("window:1:0", "Telar", "data:image/png;base64,TELAR"),
      source("window:7:0", "Other", "data:image/png;base64,OTHER"),
      source("window:9:0", "Plan", "data:image/png;base64,PLAN"),
    ];
    const context = await readFrontContext({
      ownSourceIds: ["window:1:0"],
      granted: { accessibility: true, screen: true },
      runScript: script({ app: "Notes", title: "Plan", selection: "two lines" }),
    });
    expect(context.screenshot).toBe("data:image/png;base64,PLAN");
    expect(context.selection).toBe("two lines");
  });

  test("a failed script leaves the composer with no context rather than failing", async () => {
    const context = await readFrontContext({ runScript: (_c, _a, _o, done) => done(new Error("timeout"), "") });
    expect(context).toMatchObject({ app: "", selection: "", screenshot: null });
  });
});

describe("the permissions", () => {
  const set = (trusted, screen) => Object.assign(electron.systemPreferences, { trusted, screen });

  test.each([
    [false, "denied", { accessibility: false, screen: false }],
    [true, "denied", { accessibility: true, screen: false }],
    [false, "granted", { accessibility: false, screen: true }],
    [true, "granted", { accessibility: true, screen: true }],
    [true, "not-determined", { accessibility: true, screen: false }],
  ])("Accessibility %p and Screen Recording %p read as %p", (trusted, screen, expected) => {
    set(trusted, screen);
    expect(permissions()).toEqual(expected);
  });

  test("are read again on every call, so a grant made while Telar runs shows up", () => {
    set(false, "denied");
    expect(permissions()).toEqual({ accessibility: false, screen: false });
    set(true, "denied");
    expect(permissions()).toEqual({ accessibility: true, screen: false });
    expect(electron.systemPreferences.prompted).toBe(0);
  });

  test("each opens its own pane of System Settings", () => {
    expect(settingsFor("accessibility")).toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    expect(settingsFor("screen")).toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    expect(settingsFor("camera")).toBeNull();
  });

  test("names the bundle System Settings lists them under", () => {
    expect(grantee("/Applications/Telar Dev.app/Contents/MacOS/Telar Dev")).toBe("Telar Dev");
    expect(grantee("/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")).toBe("Electron");
    expect(grantee("/usr/bin/telar")).toBe("Telar");
  });
});
