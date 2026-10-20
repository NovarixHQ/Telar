const { describe, expect, test } = require("bun:test");
const { asksForQuickComposer, quickComposerCommand } = require("./quick-composer-flag");

describe("telar --quick-composer", () => {
  test("is read anywhere on the command line", () => {
    expect(asksForQuickComposer(["/usr/bin/telar", "--quick-composer"])).toBe(true);
    expect(asksForQuickComposer(["/opt/Telar/telar", "--no-sandbox", "--quick-composer", "--enable-logging"])).toBe(true);
  });

  test("a plain launch or a deep link does not ask for it", () => {
    expect(asksForQuickComposer(["/usr/bin/telar"])).toBe(false);
    expect(asksForQuickComposer(["/usr/bin/telar", "telar://app/sessions/1"])).toBe(false);
    expect(asksForQuickComposer(["/usr/bin/telar", "--quick-composer=1"])).toBe(false);
    expect(asksForQuickComposer(undefined)).toBe(false);
  });

  test("names the installed executable, or the AppImage by its own path", () => {
    expect(quickComposerCommand({ platform: "linux", env: {}, execPath: "/opt/Telar/telar" })).toBe("/opt/Telar/telar --quick-composer");
    expect(quickComposerCommand({ platform: "linux", env: { APPIMAGE: "/home/me/Apps/Telar 1.0.AppImage" }, execPath: "/tmp/.mount_x/telar" })).toBe('"/home/me/Apps/Telar 1.0.AppImage" --quick-composer');
  });

  test("has no command to offer off Linux", () => {
    expect(quickComposerCommand({ platform: "darwin", env: {} })).toBeUndefined();
  });
});
