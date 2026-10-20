const { describe, expect, test } = require("bun:test");
const { updateMode } = require("./update-mode");

describe("who updates the app", () => {
  test("the app itself, on macOS", () => {
    expect(updateMode({ platform: "darwin", env: {} })).toBe("app");
  });

  test("the AppImage updates itself, a .deb leaves it to the package manager", () => {
    expect(updateMode({ platform: "linux", env: { APPIMAGE: "/home/me/Telar.AppImage" } })).toBe("appimage");
    expect(updateMode({ platform: "linux", env: {} })).toBe("package");
  });
});
