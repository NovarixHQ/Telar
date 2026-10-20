const { describe, expect, test } = require("bun:test");
const { sandboxOffReason, sandboxRefusal } = require("./linux-sandbox");

const launch = ({ platform = "linux", packaged = true, switches = [], env = {} } = {}) =>
  sandboxOffReason({ platform, packaged, hasSwitch: (name) => switches.includes(name), env });

describe("a packaged Linux app refuses to run without Chromium's sandbox", () => {
  test("a plain launch runs", () => {
    expect(launch()).toBeNull();
  });

  test("--no-sandbox, as the AppImage launcher adds it when user namespaces are blocked, is refused", () => {
    expect(launch({ switches: ["no-sandbox"] })).toBe("--no-sandbox");
  });

  test("ELECTRON_DISABLE_SANDBOX is refused", () => {
    expect(launch({ env: { ELECTRON_DISABLE_SANDBOX: "1" } })).toBe("ELECTRON_DISABLE_SANDBOX");
  });

  test("a dev checkout and other platforms are left alone", () => {
    expect(launch({ packaged: false, switches: ["no-sandbox"] })).toBeNull();
    expect(launch({ platform: "darwin", switches: ["no-sandbox"] })).toBeNull();
  });

  test("the refusal names the cause and the way out", () => {
    const message = sandboxRefusal("--no-sandbox");
    expect(message).toContain("--no-sandbox");
    expect(message).toContain("AppArmor");
    expect(message).toContain(".deb");
  });
});
