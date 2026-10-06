import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { fakeHub, fakeRunner, iPhone, pixel, simctlWithPair, WATCH_ID } from "../../../test/fake-simulator-hub";
import { bootFailure, Simulators } from "./service";
import { HUB_VERSION } from "./toolchain";

const services: Simulators[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const XCODE = "/Applications/Xcode.app/Contents/Developer";

function setup(devices: SimulatorSummary[], options: { enabled?: boolean; bootError?: string; xcrun?: number; files?: string[]; simctlList?: () => string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-simulators-"));
  roots.push(root);
  let enabled = options.enabled ?? true;
  const fake = fakeRunner({ ...(options.xcrun === undefined ? {} : { xcrun: options.xcrun }), ...(options.simctlList ? { simctlList: options.simctlList } : {}) });
  const hub = fakeHub(devices, options.bootError ? { bootError: options.bootError } : {});
  const simulators = new Simulators({
    root,
    enabled: () => enabled,
    runner: fake.runner,
    fetch: hub.fetch,
    platform: "darwin",
    exists: (file) => (options.files ?? []).includes(file),
    list: () => ["Xcode.app"],
    agentAccess: () => true,
    reservePort: async () => 4321,
    sleep: async () => undefined,
  });
  services.push(simulators);
  return { simulators, hub, ...fake, setEnabled: (next: boolean) => (enabled = next) };
}

async function ready(simulators: Simulators): Promise<SimulatorsState> {
  for (let reads = 0; reads < 50; reads += 1) {
    const state = await simulators.state();
    if (state.status === "ready" || state.status === "failed") return state;
  }
  throw new Error("the hub never became ready");
}

test("with simulators off, reading installs and starts nothing", async () => {
  const { simulators, runs, starts } = setup([iPhone()], { enabled: false });
  const state = await simulators.state();
  expect(state).toEqual({ status: "disabled", hub: { requiredVersion: HUB_VERSION, installedVersions: [], runningVersion: null }, platforms: [], simulators: [], errors: [] });
  expect(runs).toEqual([]);
  expect(starts).toEqual([]);
});

test("the first read installs and starts the hub, and later reads list iOS simulators and Android emulators", async () => {
  const { simulators } = setup([iPhone(), pixel()]);
  expect((await simulators.state()).status).toBe("installing");
  const state = await ready(simulators);
  expect(state.status).toBe("ready");
  expect(state.hub).toEqual({ requiredVersion: HUB_VERSION, installedVersions: [HUB_VERSION], runningVersion: HUB_VERSION });
  expect(state.platforms).toEqual([{ platform: "ios", available: true }]);
  expect(state.simulators.map((s) => s.id)).toEqual(["A1B2-UDID", "Pixel_8"]);
});

test("booting an iOS simulator attaches serve-sim and answers it booted", async () => {
  const { simulators, hub } = setup([iPhone()]);
  await ready(simulators);
  expect(await simulators.boot("A1B2-UDID")).toMatchObject({ id: "A1B2-UDID", booted: true });
  expect(hub.requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual(["/api/devices/boot", "/vendor/serve-sim/grid/api/start"]);
});

test("a booted emulator answers under its adb serial", async () => {
  const { simulators } = setup([pixel()]);
  await ready(simulators);
  expect(await simulators.boot("Pixel_8")).toMatchObject({ id: "emulator-5554", platform: "android", booted: true });
});

test("a refused boot answers a fixed reason, never the hub's text", async () => {
  const { simulators } = setup([iPhone()], { bootError: "No space left on device /Users/someone/secret" });
  await ready(simulators);
  await expect(simulators.boot("A1B2-UDID")).rejects.toThrow("The simulator could not start because the disk is full.");
});

test("shutting down an iOS simulator goes through serve-sim, and one already off still answers off", async () => {
  const booted = { ...iPhone(), booted: true };
  const { simulators, hub } = setup([booted]);
  await ready(simulators);
  expect(await simulators.shutdown("A1B2-UDID")).toMatchObject({ booted: false });
  expect(await simulators.shutdown("A1B2-UDID")).toMatchObject({ booted: false });
  expect(hub.requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual(["/vendor/serve-sim/grid/api/shutdown", "/vendor/serve-sim/grid/api/shutdown"]);
});

test("an unknown id is not found, and actions refuse while simulators are off", async () => {
  const { simulators, setEnabled } = setup([iPhone()]);
  await ready(simulators);
  await expect(simulators.boot("nope")).rejects.toThrow("No simulator has that id.");
  setEnabled(false);
  await expect(simulators.boot("A1B2-UDID")).rejects.toThrow("Simulators are off.");
});

test("turning simulators off stops the hub", async () => {
  const { simulators, starts, setEnabled } = setup([iPhone()]);
  await ready(simulators);
  setEnabled(false);
  await simulators.settingsChanged({ enabled: false, agentAccess: false });
  expect(await starts[0]!.handle.exited).toBeNull();
  expect((await simulators.state()).hub.runningVersion).toBeNull();
});

test("boot failures are classified the way the hub words them", () => {
  expect(bootFailure("Insufficient disk space")).toBe("disk_space");
  expect(bootFailure("Operation timed out")).toBe("timeout");
  expect(bootFailure(undefined)).toBe("launch_failed");
});

test("with the command line tools selected, the hub, simctl calls and agents all run under the Xcode in Applications", async () => {
  const { simulators, starts, runs } = setup([{ ...iPhone(), booted: true }], { xcrun: 72, files: [`${XCODE}/usr/bin/simctl`] });
  expect((await ready(simulators)).platforms).toEqual([{ platform: "ios", available: true }]);
  expect(starts[0]!.options?.env?.DEVELOPER_DIR).toBe(XCODE);
  await simulators.detail("A1B2-UDID");
  const simctl = runs.filter((run) => run.file === "xcrun" && run.args[0] === "simctl");
  expect(simctl.length).toBeGreaterThan(0);
  expect(simctl.map((run) => run.options?.env?.DEVELOPER_DIR)).toEqual(simctl.map(() => XCODE));
  expect(simulators.agentTools()).toMatchObject({ developerDir: XCODE });
});

test("a Mac without Xcode reports iOS unavailable and forces no developer dir", async () => {
  const { simulators, starts } = setup([], { xcrun: 72 });
  const state = await ready(simulators);
  expect(state.platforms).toEqual([expect.objectContaining({ platform: "ios", available: false, reason: "Install Xcode to use iOS Simulators." })]);
  expect(starts[0]!.options?.env?.DEVELOPER_DIR).toBeUndefined();
  expect(simulators.agentTools()).not.toHaveProperty("developerDir");
});

test("a watch paired with an iPhone is listed right under it, and starts and stops by its own id", async () => {
  let watchState = "Shutdown";
  const { simulators, hub } = setup([iPhone(), pixel()], { simctlList: () => simctlWithPair("A1B2-UDID", watchState) });
  const state = await ready(simulators);
  expect(state.simulators.map((s) => [s.name, s.pairedWith])).toEqual([["iPhone 16", undefined], ["Pulso Watch", "A1B2-UDID"], ["Pixel 8", undefined]]);
  hub.requests.length = 0;
  watchState = "Booted";
  expect(await simulators.boot(WATCH_ID)).toMatchObject({ id: WATCH_ID, booted: true, pairedWith: "A1B2-UDID" });
  watchState = "Shutdown";
  expect(await simulators.shutdown(WATCH_ID)).toMatchObject({ id: WATCH_ID, booted: false });
  const posts = hub.requests.filter((r) => r.method === "POST").map((r) => [r.path, r.body?.id ?? r.body?.udid]);
  expect(posts).toEqual([["/api/devices/boot", WATCH_ID], ["/vendor/serve-sim/grid/api/start", WATCH_ID], ["/vendor/serve-sim/grid/api/shutdown", WATCH_ID]]);
});

test("without Xcode no watch lookup runs", async () => {
  const { simulators, runs } = setup([], { xcrun: 72, simctlList: simctlWithPair });
  expect((await ready(simulators)).simulators).toEqual([]);
  expect(runs.some((run) => run.args[1] === "list")).toBe(false);
});
