import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestDecision, TurnObservation } from "@telar/engine-client";
import type { DriverRequest, DriverRun, TurnDriver } from "../contract";
import { ProviderUnavailableError } from "../contract";
import { createAcpDriver, type AcpDriverOptions } from "./session";

const FAKE = fileURLToPath(new URL("../../../test/fixtures/fake-acp-agent.mjs", import.meta.url));
const SAMPLE = fileURLToPath(new URL("../../../test/fixtures/acp/sample-agent.ndjson", import.meta.url));
const dirs: string[] = [];
const drivers: TurnDriver[] = [];

afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose?.();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-acp-test-"));
  dirs.push(dir);
  return dir;
}

function setup(options: AcpDriverOptions = {}) {
  const driver = createAcpDriver(options);
  drivers.push(driver);
  const logFile = path.join(scratch(), "agent.log");
  const sent = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> }) : []);
  const turn = (script: string, run: Partial<DriverRun> = {}, env: Record<string, string> = {}) => {
    const observations: TurnObservation[] = [];
    const controller = new AbortController();
    let working: () => void = () => {};
    const promptReached = new Promise<void>((resolve) => (working = resolve));
    const result = driver.run({
      prompt: "hi",
      sessionId: "session_acp",
      cwd: os.tmpdir(),
      signal: controller.signal,
      binaryPath: process.execPath,
      extraArgs: [FAKE],
      env: { ACP_FAKE_SCRIPT: script, ACP_FAKE_LOG: logFile, ...env },
      onObservations: async (batch) => {
        observations.push(...batch);
        if (batch.some((o) => o.kind === "content.delta" && o.text === "working")) working();
      },
      ...run,
    });
    return { result, observations, controller, promptReached };
  };
  return { driver, turn, sent };
}

const kinds = (observations: TurnObservation[]) => observations.map((observation) => observation.kind);
const started = (observations: TurnObservation[], type: string) =>
  observations.flatMap((observation) => (observation.kind === "item.started" && observation.item.detail.type === type ? [observation.item] : []));

test("a prompt streams the reply and ends when session/prompt answers", async () => {
  const { turn } = setup();
  const { result, observations } = turn("plain");
  await expect(result).resolves.toMatchObject({ text: "hello", providerSessionId: "fake-acp-session", usage: { contextUsed: 1200, contextMax: 200_000 } });
  expect(observations.filter((o) => o.kind === "content.delta").map((o) => (o.kind === "content.delta" ? o.text : ""))).toEqual(["hel", "lo"]);
  expect(kinds(observations)).toContain("provider.session");
});

test("the next turn reuses the agent and its session, and the briefings are sent once", async () => {
  const { turn, sent } = setup();
  await turn("plain", { orientation: "You run inside Telar." }).result;
  await turn("plain", { orientation: "You run inside Telar." }).result;
  const messages = sent();
  expect(messages.filter((message) => message.method === "initialize")).toHaveLength(1);
  const prompts = messages.filter((message) => message.method === "session/prompt").map((message) => JSON.stringify(message.params?.prompt));
  expect(prompts[0]).toContain("You run inside Telar.");
  expect(prompts[1]).not.toContain("You run inside Telar.");
});

test("a permission becomes a Telar request, and the answer picks the agent's own option", async () => {
  const asked: DriverRequest[] = [];
  const gate = async (request: DriverRequest): Promise<RequestDecision> => {
    asked.push(request);
    return "accept";
  };
  const { turn } = setup();
  const { result, observations } = turn("tools", { onRequest: gate });
  await expect(result).resolves.toMatchObject({ text: "Found a.txt", usage: { tokens: { input: 10, output: 4 } } });
  expect(asked[0]).toMatchObject({ kind: "command_execution", detail: { kind: "command_execution", command: { command: "ls" } }, toolUseId: "call-1" });
  expect(started(observations, "command_execution")).toHaveLength(1);
  expect(started(observations, "reasoning")).toHaveLength(1);
  const completedTool = observations.find((o) => o.kind === "item.completed" && o.detail?.type === "command_execution");
  expect(completedTool).toMatchObject({ status: "completed", detail: { command: { command: "ls", outputPreview: "a.txt" } } });
  const plans = observations.filter((o) => (o.kind === "item.started" || o.kind === "item.updated") && o.item.detail.type === "plan");
  expect(plans.map((o) => o.kind)).toEqual(["item.started", "item.updated"]);
});

test("a declined permission fails the tool and the agent carries on", async () => {
  const { turn } = setup();
  const { result, observations } = turn("tools", { onRequest: async () => "decline" });
  await expect(result).resolves.toMatchObject({ text: "Not allowed" });
  expect(observations.find((o) => o.kind === "item.completed" && o.detail?.type === "command_execution")).toMatchObject({ status: "failed" });
});

test("with no gate the turn runs unattended and takes the allow option", async () => {
  const { turn } = setup();
  await expect(turn("tools").result).resolves.toMatchObject({ text: "Found a.txt" });
});

test("an update Telar does not know becomes an unknown row and the turn goes on", async () => {
  const { turn } = setup();
  const { result, observations } = turn("unknown");
  await expect(result).resolves.toMatchObject({ text: "still here" });
  expect(started(observations, "unknown")).toEqual([expect.objectContaining({ detail: { type: "unknown", label: "mystery_update", payload: { sessionUpdate: "mystery_update", detail: 1 } } })]);
});

test("an advertised model the agent then refuses is a warning, not a failed turn", async () => {
  const { turn, sent } = setup();
  const { result, observations } = turn("options", { model: "smart" });
  await expect(result).resolves.toMatchObject({ text: "hello" });
  expect(observations.find((o) => o.kind === "runtime.warning")).toMatchObject({ message: expect.stringContaining("smart is not available on this plan") });

  await turn("options", { model: "fast" }).result;
  expect(sent().filter((message) => message.method === "session/set_config_option")).toHaveLength(1);
});

test("a stop sends session/cancel and the turn ends when the agent answers", async () => {
  const { turn, sent } = setup();
  const { result, controller, promptReached } = turn("cancel");
  await promptReached;
  controller.abort(new Error("stopped by the person"));
  await expect(result).rejects.toThrow("stopped by the person");
  expect(sent().some((message) => message.method === "session/cancel")).toBeTrue();
});

test("an agent that ignores the cancel is killed after the grace period, and the next turn starts over", async () => {
  const timers: Array<{ run: () => void; ms: number }> = [];
  const clock = { setTimeout: (run: () => void, ms: number) => timers.push({ run, ms }), clearTimeout: () => undefined };
  const { turn, sent } = setup({ clock, cancelGraceMs: 5_000 });
  const { result, controller, promptReached } = turn("hang");
  await promptReached;
  controller.abort(new Error("stopped"));
  expect(timers.find((timer) => timer.ms === 5_000)).toBeDefined();
  timers.find((timer) => timer.ms === 5_000)!.run();
  await expect(result).rejects.toThrow("stopped");

  const next = turn("plain", { providerSessionId: "session-before-the-kill" });
  await expect(next.result).resolves.toMatchObject({ text: "hello" });
  expect(sent().filter((message) => message.method === "initialize")).toHaveLength(2);
  expect(next.observations.find((o) => o.kind === "runtime.warning")).toMatchObject({ message: expect.stringContaining("does not remember") });
});

test("an agent that dies mid-turn fails the turn with what it said", async () => {
  const { turn } = setup();
  await expect(turn("crash").result).rejects.toThrow("the agent exited");
});

test("an instance with no command is unavailable rather than a spawn error", async () => {
  const { turn } = setup();
  await expect(turn("plain", { binaryPath: undefined }).result).rejects.toBeInstanceOf(ProviderUnavailableError);
});

test("a recorded transcript replays into the same rows", async () => {
  const { turn } = setup();
  const { result, observations } = turn("plain", {}, { ACP_FAKE_REPLAY: SAMPLE });
  await expect(result).resolves.toMatchObject({ text: "The readme is a single heading.", providerSessionId: "rec-1" });
  expect(started(observations, "file_read")).toEqual([expect.objectContaining({ detail: { type: "file_read", read: { path: "/tmp/project/README.md" } } })]);
  expect(started(observations, "unknown")).toEqual([]);
});

test("TELAR_ACP_RECORD keeps every line both ways as NDJSON", async () => {
  const dir = scratch();
  process.env.TELAR_ACP_RECORD = dir;
  try {
    await setup().turn("plain").result;
  } finally {
    delete process.env.TELAR_ACP_RECORD;
  }
  const [file] = fs.readdirSync(dir);
  const lines = fs.readFileSync(path.join(dir, file!), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { direction: string; line: { method?: string } });
  expect(lines[0]).toMatchObject({ direction: "out", line: { method: "initialize" } });
  expect(lines.some((entry) => entry.direction === "in" && entry.line.method === "session/update")).toBeTrue();
});

test("Telar's tools reach the agent through the stdio bridge, and a rotated token is rewritten for it", async () => {
  const { turn, sent } = setup();
  await turn("plain", { telarSocketLease: { url: "http://127.0.0.1:1/mcp", token: "first", generation: "1" } }).result;
  const servers = sent().find((message) => message.method === "session/new")!.params!.mcpServers as Array<{ name: string; command: string; env: Array<{ name: string; value: string }> }>;
  expect(servers).toEqual([expect.objectContaining({ name: "telar", command: process.execPath })]);
  const leaseFile = servers[0]!.env.find((entry) => entry.name === "TELAR_MCP_BRIDGE_LEASE")!.value;
  expect(JSON.parse(fs.readFileSync(leaseFile, "utf8"))).toEqual({ url: "http://127.0.0.1:1/mcp", token: "first" });

  await turn("plain", { telarSocketLease: { url: "http://127.0.0.1:1/mcp", token: "second", generation: "2" } }).result;
  expect(JSON.parse(fs.readFileSync(leaseFile, "utf8"))).toMatchObject({ token: "second" });
});
