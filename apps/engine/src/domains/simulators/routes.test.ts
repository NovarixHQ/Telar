import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, EngineClientError } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { fakeHub, fakeRunner, iPhone } from "../../../test/fake-simulator-hub";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function engine() {
  const engineRoot = fs.mkdtempSync(path.join(os.tmpdir(), "telar-simulators-http-"));
  roots.push(engineRoot);
  const fake = fakeRunner();
  const hub = fakeHub([iPhone()]);
  const daemon = await startEngine({
    models: stubModels,
    engineRoot,
    simulators: { runner: fake.runner, fetch: hub.fetch, platform: "darwin", reservePort: async () => 4321, sleep: async () => undefined },
  });
  daemons.push(daemon);
  return { client: new EngineClient(daemon.discovery), engineRoot, ...fake };
}

test("simulators are off until the setting turns them on, and off means nothing was installed", async () => {
  const { client, engineRoot, runs } = await engine();
  expect(await client.simulatorSettings()).toEqual({ simulatorSettings: { enabled: false, agentAccess: false } });
  expect((await client.simulators()).simulators.status).toBe("disabled");
  await expect(client.bootSimulator("A1B2-UDID")).rejects.toMatchObject({ code: "conflict" });
  expect(runs).toEqual([]);
  expect(fs.existsSync(path.join(engineRoot, "tools"))).toBe(false);
});

test("turning simulators on starts the hub, and the list, boot and shutdown routes answer through it", async () => {
  const { client, starts } = await engine();
  await client.setSimulatorSettings({ enabled: true });
  let state = (await client.simulators()).simulators;
  for (let reads = 0; state.status !== "ready" && reads < 50; reads += 1) state = (await client.simulators()).simulators;
  expect(state.simulators).toEqual([iPhone()]);
  expect(starts[0]!.args).toContain("127.0.0.1");
  expect(await client.bootSimulator("A1B2-UDID")).toEqual({ simulator: { ...iPhone(), booted: true } });
  expect(await client.shutdownSimulator("A1B2-UDID")).toEqual({ simulator: iPhone() });
  const missing = await client.bootSimulator("nope").catch((error: unknown) => error);
  expect(missing).toBeInstanceOf(EngineClientError);
  expect((missing as EngineClientError).code).toBe("not_found");
});

test("agent access needs simulators on, and turning simulators off takes it away and stops the hub", async () => {
  const { client, starts } = await engine();
  await expect(client.setSimulatorSettings({ agentAccess: true })).rejects.toMatchObject({ code: "invalid_request" });
  expect(await client.setSimulatorSettings({ enabled: true, agentAccess: true })).toEqual({ simulatorSettings: { enabled: true, agentAccess: true } });
  let state = (await client.simulators()).simulators;
  for (let reads = 0; state.status !== "ready" && reads < 50; reads += 1) state = (await client.simulators()).simulators;
  expect(await client.setSimulatorSettings({ enabled: false })).toEqual({ simulatorSettings: { enabled: false, agentAccess: false } });
  expect(await starts[0]!.handle.exited).toBeNull();
  expect((await client.simulators()).simulators.status).toBe("disabled");
});
