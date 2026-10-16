/**
 * A task the engine keeps alive past its turn asks for permission under itself: the request is parked under the
 * task, answered on the heartbeat, and never opens a turn. The settled turn's own claim is refused in words the child can act on.
 */
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../daemon";
import type { DriverRun, DriverSessionHooks, TurnDriver } from "../drivers";
import { EngineWorker } from ".";
import { stubModels } from "../../test/stub-models";
import { until } from "../../test/wait";
import { STUB_CAPABILITIES } from "../../test/stub-driver";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const workers: EngineWorker[] = [];

afterEach(async () => {
  for (const worker of workers.splice(0).reverse()) await worker.stop();
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** What the turn left behind: the settled claim's gate, and the session door
 *  the driver opens a new claim through. */
type Dispatched = {
  /** The gate bound to the turn that has now settled — the dead claim. */
  settledGate: NonNullable<DriverRun["onRequest"]>;
  session: DriverSessionHooks;
};

/**
 * A driver that dispatches ONE backgrounded agent and answers, the shape #891
 * was filed on. It keeps nothing alive itself — the point is what the ENGINE
 * does with the row and the claim after `run` returns.
 */
function dispatchingDriver(): { driver: TurnDriver; dispatched: Promise<Dispatched> } {
  let announce!: (value: Dispatched) => void;
  const dispatched = new Promise<Dispatched>((resolve) => { announce = resolve; });
  const driver: TurnDriver = {
    capabilities: STUB_CAPABILITIES, run: async ({ onObservations, onRequest, session }) => {
      await onObservations([
        {
          kind: "task.started",
          task: {
            id: "task_toolu_agent",
            kind: "agent",
            // THE FIELD THAT MAKES IT OUTLIVE THE TURN. `isBackgroundWork`
            // reads `kind === "background" || backgrounded === true`.
            backgrounded: true,
            state: "running",
            title: "build the thing",
            providerTaskId: "sdk_agent",
          },
        },
      ]);
      announce({ settledGate: onRequest!, session: session! });
      return { text: "dispatched; it will report back" };
    },
  };
  return { driver, dispatched };
}

async function engine(): Promise<{ daemon: EngineDaemon; client: EngineClient }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-bgclaim-"));
  roots.push(directory);
  const daemon = await startEngine({ models: stubModels, engineRoot: directory, workerLeaseMs: 60_000 });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: "/tmp" });
  // The default runtime mode is `auto`, so a `tool_call` resolves by policy
  // rather than parking — what a detached builder's session actually is.
  await client.createSession({ id: "session_one", projectId: "project_one" });
  return { daemon, client };
}

async function turnThatDispatches(): Promise<{ client: EngineClient; dispatched: Promise<Dispatched>; parentRunId: string }> {
  const { client } = await engine();
  const { driver, dispatched } = dispatchingDriver();
  const worker = new EngineWorker({ client, workerId: "worker_bg", driver, pollMs: 10, onDiagnostic: () => {} });
  workers.push(worker);
  await worker.start();
  await client.submitTurn("session_one", { runId: "run_parent", input: "dispatch a builder" });
  await until("the parent turn to settle", async () => {
    const turns = (await client.session("session_one")).turns;
    return turns.some((turn) => turn.runId === "run_parent" && turn.state === "completed");
  });
  return { client, dispatched, parentRunId: "run_parent" };
}

test("the engine keeps the row alive and settles its claim — and the turn's own gate is then refused, in words the child can act on", async () => {
  const { client, dispatched } = await turnThatDispatches();
  const { settledGate } = await dispatched;

  // BOTH HALVES OF THE CONTRADICTION, in one snapshot: the task is alive…
  const snapshot = await client.session("session_one");
  expect(snapshot.tasks.map((task) => [task.id, task.state])).toEqual([["task_toolu_agent", "running"]]);
  // …and the turn it was launched from has settled.
  expect(snapshot.turns.find((turn) => turn.runId === "run_parent")?.state).toBe("completed");

  /**
   * THE FLOOR (#891 fix 1, #835 remedy 2). Reaching the dead claim is still
   * possible — another driver, a genuine race — and when it happens the child
   * is told what actually went wrong. The engine's own sentence is written for
   * a daemon log; it rides along in parentheses rather than being the whole
   * message, because a model that reads plumbing as a person's "no" reports
   * back that the human declined (#28).
   */
  const refusal = await settledGate({
    kind: "tool_call",
    detail: { kind: "command_execution", command: { command: "rm -rf build" } },
    toolUseId: "toolu_child",
  }).then(() => undefined, (error: unknown) => error as Error);
  expect(refusal).toBeInstanceOf(Error);
  expect(refusal!.message).toContain("the turn it was made under has ended");
  expect(refusal!.message).toContain("nobody declined it");
  expect(refusal!.message).toContain("turn has already settled");
});

test("a request from live background work is parked under its task, opens no turn, and its answer reaches the driver", async () => {
  const { client, dispatched } = await turnThatDispatches();
  const { session } = await dispatched;
  await client.updateSession("session_one", { runtimeMode: "approval-required" });

  const outcome = session.onTaskRequest!("task_toolu_agent", {
    kind: "tool_call",
    detail: { kind: "command_execution", command: { command: "bun test" } },
    toolUseId: "toolu_child",
  });
  await until("the request to park", async () => (await client.session("session_one")).requests.some((request) => request.id === "req_toolu_child" && request.state === "open"));
  const parked = await client.session("session_one");
  expect(parked.requests.find((request) => request.id === "req_toolu_child")).toMatchObject({ taskId: "task_toolu_agent", runId: "run_parent" });
  expect(parked.turns.map((turn) => turn.runId)).toEqual(["run_parent"]);

  await client.resolveRequest("session_one", "req_toolu_child", { decision: "accept" });
  await expect(outcome).resolves.toMatchObject({ decision: "accept" });
  expect((await client.session("session_one")).turns.map((turn) => turn.runId)).toEqual(["run_parent"]);
});

test("a task that ends takes its open request with it, and the driver is told", async () => {
  const { client, dispatched } = await turnThatDispatches();
  const { session } = await dispatched;
  await client.updateSession("session_one", { runtimeMode: "approval-required" });
  const outcome = session.onTaskRequest!("task_toolu_agent", {
    kind: "tool_call",
    detail: { kind: "command_execution", command: { command: "rm -rf build" } },
    toolUseId: "toolu_child",
  });
  await until("the request to park", async () => (await client.session("session_one")).requests.some((request) => request.state === "open"));

  await session.onTasks([{ kind: "task.completed", task: { id: "task_toolu_agent", kind: "agent", backgrounded: true, state: "stopped", providerTaskId: "sdk_agent" } }]);
  await expect(outcome).resolves.toMatchObject({ decision: "cancel" });
  expect((await client.session("session_one")).requests[0]).toMatchObject({ state: "resolved", decision: "cancel", resolvedBy: "cancelled" });
});
