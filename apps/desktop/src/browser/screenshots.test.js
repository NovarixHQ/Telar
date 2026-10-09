const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, expect, test } = require("bun:test");

const { makeHarness } = require("../../test/browser-manager-harness");

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-screenshots-"));
  dirs.push(dir);
  const { manager } = makeHarness();
  const written = [];
  const loaded = [];
  manager.screenshotsPath = () => dir;
  manager.electron = () => ({
    clipboard: { writeImage: (image) => written.push(image) },
    nativeImage: { createFromPath: (file) => { loaded.push(file); return { isEmpty: () => !fs.existsSync(file) }; } },
  });
  manager.declareProfile("s", "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await manager.createTab("s", "https://docs.example.com/page");
  return { manager, dir, written, loaded };
}

describe("browser screenshots", () => {
  test("saving writes the page's PNG into the screenshots folder, named for the site", async () => {
    const { manager, dir } = await harness();
    const saved = await manager.saveScreenshot("s");
    expect(path.dirname(saved.path)).toBe(dir);
    expect(path.basename(saved.path)).toMatch(/^screenshot-docs-example-com-[a-z0-9]+\.png$/);
    expect(fs.readFileSync(saved.path).length).toBeGreaterThan(0);
  });

  test("copying puts a saved screenshot on the clipboard as an image", async () => {
    const { manager, written, loaded } = await harness();
    const saved = await manager.saveScreenshot("s");
    expect(manager.copyScreenshot(saved.path)).toEqual({ ok: true });
    expect(loaded).toEqual([saved.path]);
    expect(written).toHaveLength(1);
  });

  test("copying refuses a file outside the screenshots folder without reading it", async () => {
    const { manager, loaded } = await harness();
    expect(() => manager.copyScreenshot("/etc/hosts")).toThrow(/not a browser screenshot/);
    expect(loaded).toEqual([]);
  });
});
