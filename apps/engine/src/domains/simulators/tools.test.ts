import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { iPhone, PNG, simulatorEngine } from "../../../test/fake-simulator-hub";
import type { DriverRun, TurnDriver } from "../../drivers";
import { type TelarCapabilities, telarWall, type ToolFactory, toSdkTools } from "../agent-tools";
import { AGENT_DEVICE, installedVersions, toolBinDir } from "./toolchain";

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the condition never held");
}

function heldDriver() {
  type Held = { run: DriverRun; release: () => void };
  const arrived: Held[] = [];
  const waiting: Array<(turn: Held) => void> = [];
  const driver: TurnDriver = {
    run: (run) =>
      new Promise((resolve) => {
        const turn = { run, release: () => resolve({ text: "ok" }) };
        const waiter = waiting.shift();
        if (waiter) waiter(turn);
        else arrived.push(turn);
      }),
  };
  const next = () => arrived.shift() ?? new Promise<Held>((resolve) => waiting.push(resolve));
  return { driver, next };
}

function wall(run: DriverRun): Map<string, Handler> {
  const tools = new Map<string, Handler>();
  const factory = ((name: string, _description: string, _shape: unknown, handler: Handler) => tools.set(name, handler)) as unknown as ToolFactory;
  toSdkTools(telarWall(() => run as TelarCapabilities), factory);
  return tools;
}

async function setup() {
  const { driver, next } = heldDriver();
  const engine = await simulatorEngine({ ready: true, driver });
  closers.push(engine.close);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "telar-simulator-tools-"));
  closers.push(async () => fs.rmSync(project, { recursive: true, force: true }));
  await engine.client.registerProject({ id: "project_sim", name: "sim", root: project });
  await engine.client.createSession({ id: "session_sim", projectId: "project_sim", driver: "claude" });
  let sent = 0;
  const turn = async () => {
    sent += 1;
    await engine.client.submitTurn("session_sim", { runId: `run_${sent}`, input: "go" });
    return next();
  };
  return { ...engine, turn };
}

test("the simulator tools are absent until agent access is on, and then agent-device is on the provider's PATH", async () => {
  const { client, engineRoot, turn } = await setup();
  const first = await turn();
  expect(first.run.simulators).toBeUndefined();
  expect([...wall(first.run).keys()].some((name) => name.startsWith("simulator_"))).toBe(false);
  first.release();

  await client.setSimulatorSettings({ agentAccess: true });
  await eventually(() => installedVersions(engineRoot, AGENT_DEVICE), (versions) => versions.length > 0);
  const second = await turn();
  expect([...wall(second.run).keys()].filter((name) => name.startsWith("simulator_")).sort()).toEqual(["simulator_close", "simulator_list", "simulator_open", "simulator_screenshot"]);
  expect(second.run.env?.PATH?.split(path.delimiter)[0]).toBe(toolBinDir(engineRoot, AGENT_DEVICE));
  second.release();
});

test("an agent lists, opens, screenshots and closes a simulator, and the open is recorded on the session", async () => {
  const { client, engineRoot, turn } = await setup();
  await client.setSimulatorSettings({ agentAccess: true });
  await eventually(() => installedVersions(engineRoot, AGENT_DEVICE), (versions) => versions.length > 0);
  const { run, release } = await turn();
  const tools = wall(run);
  const call = (name: string, args: Record<string, unknown> = {}) => tools.get(name)!(args);

  const listed = await call("simulator_list");
  expect(JSON.parse(listed.content[0]!.text!).simulators).toEqual([iPhone()]);

  const opened = await call("simulator_open", { simulatorId: "A1B2-UDID" });
  expect(opened.isError).toBeUndefined();
  expect(opened.content[0]!.text).toContain(`${path.join(toolBinDir(engineRoot, AGENT_DEVICE), "agent-device")} (use this exact path`);
  expect(opened.content[0]!.text).toContain("--platform ios --udid A1B2-UDID");

  const shot = await call("simulator_screenshot", { simulatorId: "A1B2-UDID" });
  expect(shot.content).toEqual([{ type: "image", data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" }]);

  expect((await call("simulator_close", { simulatorId: "A1B2-UDID" })).content[0]!.text).toContain("keeps running");
  expect((await client.simulators()).simulators.simulators[0]!.booted).toBe(true);
  expect((await call("simulator_close", { simulatorId: "A1B2-UDID", shutdown: true })).content[0]!.text).toContain("turned off");
  const shown = await eventually(
    async () => (await client.events("session_sim")).events.flatMap((event) => (event.type === "simulator.opened" ? [`opened ${event.simulator.id} ${event.simulator.booted}`] : event.type === "simulator.closed" ? [`closed ${event.simulatorId}`] : [])),
    (found) => found.length === 3,
  );
  expect(shown).toEqual(["opened A1B2-UDID true", "closed A1B2-UDID", "closed A1B2-UDID"]);
  const closedShot = await call("simulator_screenshot", { simulatorId: "A1B2-UDID" });
  expect(closedShot.isError).toBe(true);
  expect(closedShot.content[0]!.text).toContain("not running");
  expect((await call("simulator_open", { simulatorId: "nope" })).isError).toBe(true);
  release();
});

test("turning simulators off takes the tools away from the next turn", async () => {
  const { client, turn } = await setup();
  await client.setSimulatorSettings({ agentAccess: true });
  (await turn()).release();
  await client.setSimulatorSettings({ enabled: false });
  const next = await turn();
  expect(next.run.simulators).toBeUndefined();
  next.release();
});
