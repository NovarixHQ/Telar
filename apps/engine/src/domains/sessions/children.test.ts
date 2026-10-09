import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";

const homes: string[] = [];
const stores: EngineStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.kernel.executionStore.close();
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

const HOST = "session_host";

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-children-"));
  homes.push(home);
  let now = 1_000_000;
  const store = new EngineStore(home, () => (now += 1));
  stores.push(store);
  store.projectRegistry.register({ id: "project_one", name: "test", root: "/tmp" });
  for (const id of [HOST, "session_a", "session_b", "session_other"]) store.lifecycle.createSession({ id, projectId: "project_one", title: id.replace("session_", "worker ") });
  let runs = 0;

  /** Runs a turn on `sessionId` (its queued one, or a new one) and hands back what it can do while running. */
  const run = (sessionId: string) => {
    if (!store.queries.turns(sessionId).some((turn) => turn.state === "queued")) {
      store.intake.submitTurn(sessionId, { runId: `run_${sessionId}_${++runs}`, input: "go" });
    }
    const claimed = store.claims.claimTurn(sessionId, `worker_${sessionId}`)!;
    const token = claimed.claim!.token;
    store.turnLifecycle.markRunning(sessionId, claimed.runId, token);
    const proof = { sessionId, runId: claimed.runId, claimToken: token };
    const say = (to: string, intent: "task" | "result" | "blocker" | "fyi", input: string) =>
      store.intake.submitAgentTurn(to, { runId: `run_say_${++runs}`, input, intent }, proof);
    return {
      runId: claimed.runId,
      say,
      complete: (text = "finished") => store.turnLifecycle.completeTurn(sessionId, claimed.runId, token, { text }),
      fail: () => store.turnLifecycle.failTurn(sessionId, claimed.runId, token, { code: "driver_failed", message: "the CLI died\nstack" }),
      stop: () => store.turnLifecycle.stopTurn(sessionId, claimed.runId),
    };
  };

  /** The host tasks each child in one turn and ends it. */
  const task = (...children: string[]) => {
    const host = run(HOST);
    for (const child of children) host.say(child, "task", `Do ${child}.`);
    host.complete();
    return host.runId;
  };

  /** Turns on the host that its model is handed. */
  const woken = () => store.queries.turns(HOST).filter((turn) => turn.origin === "session" && turn.agentDelivery !== "passive");
  const children = () => store.children.childrenOf(HOST);
  return { store, run, task, woken, children };
}

test("a task registers the child under the run that sent it", () => {
  const { task, children } = setup();
  const hostRun = task("session_a");
  expect(children()).toEqual([
    expect.objectContaining({ sessionId: "session_a", parentSessionId: HOST, parentRunId: hostRun, title: "worker a", provider: "claude", state: "working" }),
  ]);
});

test("a result ends the child as done and wakes an idle parent with one line and where to read it", () => {
  const { run, task, woken, children } = setup();
  task("session_a");
  const a = run("session_a");
  const { turn: result } = a.say(HOST, "result", "Merged #12; CI green.\nDetails follow at length.");
  expect(result.agentDelivery).toBe("passive");

  const [wake] = woken();
  expect(woken()).toHaveLength(1);
  expect(wake!.notification!.body).toBe(
    `[builder done] "worker a" (session_a) — Merged #12; CI green. · read it with sessions_read(sessionId: "${HOST}", runId: "${result.runId}")`,
  );
  expect(wake!.wakeReason).toMatchObject({ kind: "turn_completed", sessionId: "session_a" });
  expect(children()[0]).toMatchObject({ state: "done", summary: "Merged #12; CI green.", fetch: { sessionId: HOST, runId: result.runId } });

  a.complete();
  expect(woken()).toHaveLength(1);
});

test("two builders finishing while the parent works reach it as one merged line after its turn", () => {
  const { run, task, woken } = setup();
  task("session_a", "session_b");
  const host = run(HOST);
  const a = run("session_a");
  a.say(HOST, "result", "Settings mockup ready.");
  a.complete();
  const b = run("session_b");
  b.fail();
  expect(woken().filter((turn) => turn.wakeReason)).toHaveLength(0);

  host.complete();
  const wakes = woken().filter((turn) => turn.wakeReason);
  expect(wakes).toHaveLength(1);
  const body = wakes[0]!.notification!.body;
  expect(body.split("\n")[0]).toBe('2 builders finished · "worker a" (done) · "worker b" (failed: driver_failed: the CLI died). Read any with sessions_read.');
  expect(body).toContain('[builder failed] "worker b" (session_b) — driver_failed: the CLI died · read it with sessions_read(sessionId: "session_b"');
});

test("a blocker makes the child wait and wakes the parent at once; only a task answers it", () => {
  const { run, task, woken, children } = setup();
  task("session_a");
  const a = run("session_a");
  a.say(HOST, "blocker", "Which database?");
  expect(woken().map((turn) => turn.agentIntent)).toEqual(["blocker"]);
  a.complete("waiting on the answer");
  expect(children()[0]!.state).toBe("waiting");

  const host = run(HOST);
  expect(() => host.say("session_a", "fyi", "postgres")).toThrow(/blocker/);
  host.say("session_a", "task", "Use postgres.");
  host.complete();
  expect(children()[0]).toMatchObject({ state: "working", parentRunId: host.runId });
});

test("a failure, a stop and a turn that ends without a result each end the child once", () => {
  const { store, run, task, children } = setup();
  task("session_a", "session_b", "session_other");
  run("session_a").fail();
  run("session_b").stop();
  run("session_other").complete("I looked around.\nMore.");
  const states = Object.fromEntries(children().map((child) => [child.sessionId, [child.state, child.summary]]));
  expect(states).toEqual({
    session_a: ["failed", "driver_failed: the CLI died"],
    session_b: ["stopped", "stopped"],
    session_other: ["done", "finished without a result: I looked around."],
  });
  const endings = store.queries.turns(HOST).filter((turn) => turn.wakeReason).flatMap((turn) => turn.notification?.entries ?? []);
  expect(endings.map((entry) => entry.sessionId).sort()).toEqual(["session_a", "session_b", "session_other"]);
});

test("a child that will run again is not done when one turn ends", () => {
  const { store, run, task, children } = setup();
  task("session_a");
  const a = run("session_a");
  store.intake.submitTurn("session_a", { runId: "run_next", input: "and then" });
  a.complete();
  expect(children()[0]!.state).toBe("working");
});

test("a child settled before it reported is stopped; a parent settled drops its children", () => {
  const { store, task, children, woken } = setup();
  task("session_a", "session_b");
  store.lifecycle.updateSession("session_a", { settledOverride: "settled" });
  expect(children().find((child) => child.sessionId === "session_a")).toMatchObject({ state: "stopped", summary: "settled" });
  expect(woken().at(-1)!.notification!.body).toContain('[builder stopped] "worker a" (session_a) — settled');

  store.lifecycle.updateSession(HOST, { settledOverride: "settled" });
  expect(children()).toEqual([]);
});

test("an archived child is stopped", () => {
  const { store, task, children } = setup();
  task("session_a");
  store.turnLifecycle.stopSession("session_a");
  store.lifecycle.archiveSession("session_a");
  expect(children()[0]).toMatchObject({ state: "stopped", summary: "archived" });
});

test("a handoff moves the record to the new parent, and a detach drops it", () => {
  const { store, task, children } = setup();
  task("session_a");
  store.handoff.handOff("session_a", { to: "session_other" });
  expect(children()).toEqual([]);
  expect(store.children.childrenOf("session_other")).toEqual([expect.objectContaining({ sessionId: "session_a", parentSessionId: "session_other", state: "working" })]);

  store.handoff.handOff("session_a", {});
  expect(store.children.childrenOf("session_other")).toEqual([]);
});

test("a working child shows what its live turn is doing", () => {
  const { store, run, task, children } = setup();
  task("session_a");
  const a = run("session_a");
  const token = store.queries.turns("session_a").find((turn) => turn.runId === a.runId)!.claim!.token;
  const command = (id: string, title: string) => ({ kind: "item.started", item: { id, title, detail: { type: "command_execution", command: { command: title } } } });
  store.ingest.ingestObservations("session_a", a.runId, token, [
    command("item_one", "bun test"),
    { kind: "item.completed", itemId: "item_one", status: "completed" },
    command("item_two", "bun run check"),
  ]);
  expect(children()[0]!.progress).toBe("bun run check · 2 tools");
});

function backgroundTask(store: EngineStore, sessionId: string, runId: string, state: "running" | "completed") {
  const task = { id: "task_ci", sessionId, runId, kind: "background" as const, state, title: "Wait for CI", startedAt: 1, updatedAt: 2 };
  store.sessionTasks.write(sessionId, new Map([[task.id, task]]));
}

test("a builder that ends a turn while its background work runs, then sends its result, gives one notice", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const a = run("session_a");
  backgroundTask(store, "session_a", a.runId, "running");
  a.complete("Waiting on CI.");
  expect(woken()).toHaveLength(0);
  expect(children()[0]!.state).toBe("working");

  backgroundTask(store, "session_a", a.runId, "completed");
  const again = run("session_a");
  again.say(HOST, "result", "CI green; PR #7.");
  again.complete();
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("CI green; PR #7.");
  expect(children()[0]).toMatchObject({ state: "done", summary: "CI green; PR #7." });
});

test("a builder that ends without a result and nothing pending gives one notice", () => {
  const { run, task, woken } = setup();
  task("session_a");
  run("session_a").complete("Looked around.");
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("finished without a result: Looked around.");
});

test("a blocker reaches the parent at once even while background work runs", () => {
  const { store, run, task, woken } = setup();
  task("session_a");
  const a = run("session_a");
  backgroundTask(store, "session_a", a.runId, "running");
  a.say(HOST, "blocker", "Which database?");
  expect(woken().map((turn) => turn.agentIntent)).toEqual(["blocker"]);
});
