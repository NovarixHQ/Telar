import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { EngineClientError } from "@telar/engine-client";
import { iPhone, pixel, simctlWithPair, simulatorEngine, WATCH_ID } from "../../../test/fake-simulator-hub";
import type { HubSocket } from "./input";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function engine(options: Parameters<typeof simulatorEngine>[0] = {}) {
  const running = await simulatorEngine(options);
  closers.push(running.close);
  return running;
}

const codeOf = (promise: Promise<unknown>) => promise.then(() => undefined, (error: EngineClientError) => error.code);

test("simulators are off until the setting turns them on, and off means nothing was installed", async () => {
  const { client, engineRoot, runs } = await engine();
  expect(await client.simulatorSettings()).toEqual({ simulatorSettings: { enabled: false, agentAccess: false } });
  expect((await client.simulators()).simulators.status).toBe("disabled");
  expect(await codeOf(client.bootSimulator("A1B2-UDID"))).toBe("conflict");
  expect(await codeOf(client.simulatorAction("A1B2-UDID", { type: "setAppearance", value: "dark" }))).toBe("conflict");
  expect(runs).toEqual([]);
  expect(fs.existsSync(path.join(engineRoot, "tools"))).toBe(false);
});

test("turning simulators on starts the hub, and the list, boot and shutdown routes answer through it", async () => {
  const { client, starts } = await engine({ ready: true });
  expect((await client.simulators()).simulators.simulators).toEqual([iPhone()]);
  expect(starts[0]!.args).toContain("127.0.0.1");
  expect(await client.bootSimulator("A1B2-UDID")).toEqual({ simulator: { ...iPhone(), booted: true } });
  expect(await client.shutdownSimulator("A1B2-UDID")).toEqual({ simulator: iPhone() });
  expect(await codeOf(client.bootSimulator("nope"))).toBe("not_found");
});

test("agent access needs simulators on, and turning simulators off takes it away and stops the hub", async () => {
  const { client, starts } = await engine();
  expect(await codeOf(client.setSimulatorSettings({ agentAccess: true }))).toBe("invalid_request");
  expect(await client.setSimulatorSettings({ enabled: true, agentAccess: true })).toEqual({ simulatorSettings: { enabled: true, agentAccess: true } });
  let state = (await client.simulators()).simulators;
  for (let reads = 0; state.status !== "ready" && reads < 50; reads += 1) state = (await client.simulators()).simulators;
  expect(await client.setSimulatorSettings({ enabled: false })).toEqual({ simulatorSettings: { enabled: false, agentAccess: false } });
  expect(await starts[0]!.handle.exited).toBeNull();
  expect((await client.simulators()).simulators.status).toBe("disabled");
});

test("an action runs simctl on the simulator and answers its detail; a malformed one runs nothing", async () => {
  const { client, runs } = await engine({ ready: true });
  const before = runs.length;
  expect(await codeOf(client.simulatorAction("A1B2-UDID", { type: "setAppearance", value: "sepia" } as never))).toBe("invalid_request");
  expect(runs.length).toBe(before);
  const { detail } = await client.simulatorAction("A1B2-UDID", { type: "setAppearance", value: "dark" });
  expect(detail.id).toBe("A1B2-UDID");
  expect(runs.slice(before).map((run) => [run.file, ...run.args].join(" "))).toContain("xcrun simctl ui A1B2-UDID appearance dark");
});

test("input reaches the hub's socket for an iOS simulator, and is refused for an emulator or when malformed", async () => {
  const frames: Array<{ url: string; tag: number }> = [];
  const openSocket = async (url: string): Promise<HubSocket> => ({ send: (data) => void frames.push({ url, tag: data[0]! }), close: () => undefined, open: true });
  const { client } = await engine({ ready: true, devices: [iPhone(), { ...pixel(), id: "emulator-5554", booted: true }], openSocket });
  expect(await client.sendSimulatorInput("A1B2-UDID", [{ type: "touch", phase: "begin", x: 0.5, y: 0.5 }, { type: "touch", phase: "end", x: 0.5, y: 0.5 }])).toEqual({ sent: 2 });
  expect(frames).toEqual([
    { url: "ws://127.0.0.1:4321/vendor/serve-sim/helper/ws?device=A1B2-UDID", tag: 0x03 },
    { url: "ws://127.0.0.1:4321/vendor/serve-sim/helper/ws?device=A1B2-UDID", tag: 0x03 },
  ]);
  expect(await codeOf(client.sendSimulatorInput("emulator-5554", [{ type: "button", button: "home" }]))).toBe("invalid_request");
  expect(await codeOf(client.sendSimulatorInput("A1B2-UDID", [{ type: "touch", phase: "begin", x: 2, y: 0 }]))).toBe("invalid_request");
  expect(frames).toHaveLength(2);
});

test("a paired watch's crown and side button reach the hub's socket for that watch", async () => {
  const frames: Array<{ url: string; tag: number; body: unknown }> = [];
  const openSocket = async (url: string): Promise<HubSocket> => ({
    send: (data) => void frames.push({ url, tag: data[0]!, body: JSON.parse(new TextDecoder().decode(data.subarray(1))) }),
    close: () => undefined,
    open: true,
  });
  const { client } = await engine({ ready: true, devices: [{ ...iPhone(), booted: true }], simctlList: () => simctlWithPair(), openSocket });
  expect((await client.simulators()).simulators.simulators.map((device) => device.id)).toContain(WATCH_ID);
  expect(await client.sendSimulatorInput(WATCH_ID, [{ type: "crown", delta: 40 }, { type: "button", button: "side_button" }])).toEqual({ sent: 2 });
  const url = `ws://127.0.0.1:4321/vendor/serve-sim/helper/ws?device=${WATCH_ID}`;
  expect(frames).toEqual([
    { url, tag: 0x0a, body: { delta: 40 } },
    { url, tag: 0x04, body: { button: "side_button", page: 12, usage: 149, phase: "press" } },
  ]);
  expect(await codeOf(client.sendSimulatorInput(WATCH_ID, [{ type: "crown", delta: 500 }]))).toBe("invalid_request");
});

test("a minted ticket admits a hub read at the gate, and only while the device that asked is paired", async () => {
  const { client, request } = await engine();
  const { ticket, expiresAt } = await client.simulatorStreamTicket();
  expect(expiresAt).toBeGreaterThan(Date.now());
  const decide = async (pathname: string, method: string, value: string) =>
    (await request("/v2/auth/decide", { method: "POST", body: JSON.stringify({ pathname, method, ticket: value }), headers: { "content-type": "application/json" } })).json();
  const STREAM = "/api/simulators/hub/vendor/serve-sim/helper/A1B2-UDID/stream.mjpeg";
  expect(await decide(STREAM, "GET", ticket)).toEqual({ allow: true, role: "observer" });
  expect(await decide(STREAM, "GET", "stk_forged")).toEqual({ allow: false, code: "cockpit_unauthorized" });
  expect(await decide("/api/simulators/A1B2-UDID/input", "POST", ticket)).toEqual({ allow: false, code: "cockpit_unauthorized" });
  const unpaired = await request("/v2/simulators/stream-ticket?holder=dev_gone");
  expect(unpaired.headers.get("cache-control")).toBe("no-store");
  expect(await decide(STREAM, "GET", ((await unpaired.json()) as { ticket: string }).ticket)).toEqual({ allow: false, code: "cockpit_unauthorized" });
});
