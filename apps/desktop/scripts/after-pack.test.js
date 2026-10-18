const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ENGINE_PTY, verifyPackagedPty, verifyPackagedSounds } = require("./after-pack");

function appWith(names) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "telar-pack-"));
  const resources = path.join(app, "Contents", "Resources");
  fs.mkdirSync(resources, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(resources, name), "");
  return app;
}

describe("the packaged notification sounds", () => {
  test("the Felt sound for each kind as a .caf passes", () => {
    const all = fs.readdirSync(path.join(__dirname, "..", "..", "ios", "TelarMobile", "Sounds")).filter((name) => /^telar-.*\.caf$/.test(name));
    expect(verifyPackagedSounds(appWith(all))).toBe(3);
  });

  test("a missing sound fails the build and names it", () => {
    expect(() => verifyPackagedSounds(appWith(["telar-felt-done.caf"]))).toThrow("telar-felt-error.caf");
  });
});

describe("what a packaged .app has to contain before a terminal can run", () => {
  const app = "/out/Telar.app";
  const root = path.join(app, ENGINE_PTY);
  const prebuilds = path.join(root, "prebuilds", "darwin-arm64");
  const release = path.join(root, "build", "Release");
  const both = (dir) => [path.join(dir, "pty.node"), path.join(dir, "spawn-helper")];

  const fakeFs = (present, mode = 0o100755, chmods = []) => ({
    existsSync: (target) => present.includes(target),
    statSync: () => ({ mode }),
    chmodSync: (target, next) => chmods.push([target, next]),
  });

  test("refuses an app with no node-pty beside the engine", () => {
    expect(() => verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs: fakeFs([]) })).toThrow(/build-app\.sh/);
  });

  test("refuses an app with the addon but no spawn-helper beside it", () => {
    const fs = fakeFs([path.join(prebuilds, "pty.node")]);
    expect(() => verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs })).toThrow(/spawn-helper/);
  });

  test("sets the executable bit on the packaged helper", () => {
    const chmods = [];
    const fs = fakeFs(both(prebuilds), 0o100644, chmods);
    const found = verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs });
    expect(found.chmodded).toBe(true);
    expect(chmods[0][0]).toBe(path.join(prebuilds, "spawn-helper"));
    expect(chmods[0][1]).toBe(0o755);
  });

  test("passes a well-formed app without touching it", () => {
    const chmods = [];
    const fs = fakeFs(both(prebuilds), 0o100755, chmods);
    expect(verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs }).chmodded).toBe(false);
    expect(chmods).toEqual([]);
  });

  test("checks build/Release first, because that is what node-pty loads first", () => {
    const chmods = [];
    const fs = fakeFs([...both(release), ...both(prebuilds)], 0o100644, chmods);
    const found = verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs });
    expect(found.from).toBe("build/Release");
    expect(found.addon).toBe(path.join(release, "pty.node"));

    expect(chmods).toHaveLength(1);
    expect(chmods[0][0]).toBe(path.join(release, "spawn-helper"));
  });

  test("falls back to the shipped prebuild when nothing was rebuilt", () => {
    const found = verifyPackagedPty(app, { platform: "darwin", arch: "arm64", fs: fakeFs(both(prebuilds)) });
    expect(found.from).toBe("prebuilds/darwin-arm64");
  });
});
