import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeDeviceType, fakeRunner, PNG } from "../../../test/fake-simulator-hub";
import { DeviceChrome, readDeviceType } from "./chrome";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(options: { chrome?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-chrome-"));
  roots.push(root);
  return { ...fakeDeviceType(root, options), ...fakeRunner() };
}

test("a device type's primary display and chrome give the screen in points, its place in the body and the buttons around it", async () => {
  const { bundle, chromeDir, runner } = fixture();
  const chrome = await readDeviceType({ run: runner.run, chromeDir }, bundle);
  expect(chrome?.screen).toEqual({ width: 400, height: 800, cornerRadius: 60 });
  const frame = chrome!.frame!;
  expect([frame.width, frame.height, frame.screen]).toEqual([440, 840, { x: 20, y: 20 }]);
  expect(frame.slices.topLeft).toEqual({ src: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`, width: 100, height: 100 });
  expect(frame.slices.top).toMatchObject({ width: 1, height: 100 });
  expect(frame.buttons.map(({ x, y, width, height, onTop }) => ({ x, y, width, height, onTop }))).toEqual([
    { x: 427, y: 200, width: 16, height: 100, onTop: false },
    { x: -5, y: 150, width: 16, height: 30, onTop: false },
  ]);
});

test("the chrome is drawn at three times its size so it stays sharp", async () => {
  const { bundle, chromeDir, runner, runs } = fixture();
  await readDeviceType({ run: runner.run, chromeDir }, bundle);
  const corner = runs.find((run) => run.file === "sips" && run.args.includes("-z") && String(run.args.at(-3)).endsWith("TL.pdf"));
  expect(corner?.args.slice(0, 5)).toEqual(["-s", "format", "png", "-z", "300"]);
});

test("a device type without DeviceKit chrome still gives its screen, with no frame", async () => {
  const { bundle, chromeDir, runner } = fixture({ chrome: false });
  expect(await readDeviceType({ run: runner.run, chromeDir }, bundle)).toEqual({ screen: { width: 400, height: 800, cornerRadius: 60 }, frame: null });
});

test("a simulator is found through simctl, its device type is read once, and an unknown one has no chrome", async () => {
  const { chromeDir, simctl, runs } = fixture();
  const { runner } = fakeRunner({ simctlList: () => simctl("PHONE-1") });
  const reads = new DeviceChrome({ run: (file, args, options) => (runs.push({ file, args }), runner.run(file, args, options)), chromeDir });
  expect((await reads.read("PHONE-1"))?.screen.width).toBe(400);
  const plists = runs.filter((run) => run.file === "plutil").length;
  await reads.read("PHONE-1");
  expect(runs.filter((run) => run.file === "plutil")).toHaveLength(plists);
  expect(await reads.read("NOPE")).toBeNull();
});
