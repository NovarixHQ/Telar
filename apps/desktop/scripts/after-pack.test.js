const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyPackagedSounds } = require("./after-pack");

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
