import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";
import { CUT_OFF_GRACE_MS } from "./liveness";

const homes: string[] = [];
const stores: EngineStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.kernel.executionStore.close();
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

const HOST = "session_host";

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-lineage-"));
  homes.push(home);
  let now = 1_000_000;
  const clock = () => (now += 1);
  const store = new EngineStore(home, clock);
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
      observe: (...observations: unknown[]) => store.ingest.ingestObservations(sessionId, claimed.runId, token, observations),
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
  const children = () => store.lineage.childrenOf(HOST);
  const advance = (ms: number) => void (now += ms);
  const reopen = () => {
    store.kernel.executionStore.close();
    stores.splice(stores.indexOf(store), 1);
    const fresh = new EngineStore(home, clock);
    stores.push(fresh);
    return fresh;
  };
  return { store, run, task, woken, children, advance, reopen };
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
  run("session_other").complete("Looking around.");
  run("session_other").complete("I looked around.\nMore.");
  const states = Object.fromEntries(children().map((child) => [child.sessionId, [child.state, child.summary]]));
  expect(states).toEqual({
    session_a: ["failed", "driver_failed: the CLI died"],
    session_b: ["stopped", "stopped"],
    session_other: ["done", "ended without a result and nothing is running there, so it will not continue on its own. It last said: I looked around."],
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

test("a child stopped and then archived is told as stopped, once", () => {
  const { store, task, children, woken } = setup();
  task("session_a");
  store.turnLifecycle.stopSession("session_a");
  store.lifecycle.archiveSession("session_a");
  expect(children()[0]).toMatchObject({ state: "stopped", summary: "stopped" });
  expect(woken().flatMap((turn) => turn.notification?.entries ?? []).filter((entry) => entry.sessionId === "session_a")).toHaveLength(1);
});

test("a handoff moves the record to the new parent, and a detach drops it", () => {
  const { store, task, children } = setup();
  task("session_a");
  store.handoff.handOff("session_a", { to: "session_other" });
  expect(children()).toEqual([]);
  expect(store.lineage.childrenOf("session_other")).toEqual([expect.objectContaining({ sessionId: "session_a", parentSessionId: "session_other", state: "working" })]);

  store.handoff.handOff("session_a", {});
  expect(store.lineage.childrenOf("session_other")).toEqual([]);
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

test("a builder that ends without a result and nothing pending is nudged once, and only its second idle ending reaches the parent", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  run("session_a").complete("Looked around.");
  expect(woken()).toHaveLength(0);
  expect(children()[0]!.state).toBe("working");
  const nudge = store.queries.turns("session_a").find((turn) => turn.state === "queued")!;
  expect(nudge.notification!.body).toContain("nothing is running in this session");

  run("session_a").complete("Still waiting on the report.");
  expect(store.queries.turns("session_a").some((turn) => turn.state === "queued")).toBe(false);
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("nothing is running there, so it will not continue on its own. It last said: Still waiting on the report.");
});

test("a nudged builder that then sends its result gives the parent that result and nothing else", () => {
  const { run, task, woken, children } = setup();
  task("session_a");
  run("session_a").complete("Looked around.");
  const nudged = run("session_a");
  nudged.say(HOST, "result", "Plan ready; 3 PRs.");
  nudged.complete();
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("Plan ready; 3 PRs.");
  expect(children()[0]).toMatchObject({ state: "done", summary: "Plan ready; 3 PRs." });
});

test("a builder left waiting on background agents that have all ended is nudged, then its parent is told it will not continue", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const first = run("session_a");
  backgroundTask(store, "session_a", first.runId, "running");
  first.complete("Four agents running; waiting on their reports.");
  expect(woken()).toHaveLength(0);

  backgroundTask(store, "session_a", first.runId, "completed");
  const wake = store.claims.openProviderTurn("session_a", { workerId: "worker_session_a", input: "", reason: { kind: "task_notification", taskId: "task_ci" } });
  store.turnLifecycle.completeTurn("session_a", wake.runId, wake.claim!.token, { text: "Waiting on the consolidated report of the 24 migrations." });
  expect(woken()).toHaveLength(0);
  expect(children()[0]!.state).toBe("working");

  run("session_a").complete("Waiting on the consolidated report of the 24 migrations.");
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("will not continue on its own");
  expect(children()[0]!.state).toBe("done");
});

test("a blocker reaches the parent at once even while background work runs", () => {
  const { store, run, task, woken } = setup();
  task("session_a");
  const a = run("session_a");
  backgroundTask(store, "session_a", a.runId, "running");
  a.say(HOST, "blocker", "Which database?");
  expect(woken().map((turn) => turn.agentIntent)).toEqual(["blocker"]);
});

const agent = (id: string, state: "running" | "completed" | "stopped", extra: Record<string, unknown> = {}) => ({ id, kind: "agent", state, backgrounded: true, providerTaskId: `p_${id}`, title: id, ...extra });
const started = (id: string, extra: Record<string, unknown> = {}) => ({ kind: "task.started", task: agent(id, "running", extra) });
const ended = (id: string, state: "completed" | "stopped" = "completed") => ({ kind: "task.completed", task: agent(id, state) });
const between = (store: EngineStore, ...observations: unknown[]) => store.ingest.reportSessionTasks("session_a", "worker_session_a", observations);
const queuedOn = (store: EngineStore, sessionId: string) => store.queries.turns(sessionId).filter((turn) => turn.state === "queued");

test("nested sub-agents keep the builder live until the last leaf, after the agent that launched them has ended", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const first = run("session_a");
  first.observe(...["task_inventory", "task_deps", "task_default", "task_migrations"].map((id) => started(id)));
  first.complete("Four agents running; waiting on their reports.");
  between(store, started("task_m1", { parentTaskId: "task_migrations" }), started("task_m2", { parentTaskId: "task_migrations" }));
  between(store, ended("task_migrations"), ended("task_inventory"), ended("task_deps"), ended("task_default"));
  const wake = store.claims.openProviderTurn("session_a", { workerId: "worker_session_a", input: "", reason: { kind: "task_notification", taskId: "task_migrations" } });
  store.turnLifecycle.completeTurn("session_a", wake.runId, wake.claim!.token, { text: "Waiting on the consolidated report of the 24 migrations." });
  between(store, ended("task_m1"));
  expect(queuedOn(store, "session_a")).toEqual([]);
  expect(children()[0]!.state).toBe("working");

  between(store, ended("task_m2"));
  expect(queuedOn(store, "session_a").map((turn) => turn.notification?.body)).toEqual([expect.stringContaining("nothing is running in this session")]);
  expect(woken()).toHaveLength(0);
});

test("background work lost with its process ends the builder's liveness, and the parent hears once", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const first = run("session_a");
  first.observe(started("task_review"));
  first.complete("Waiting on the review agent.");
  between(store, ended("task_review", "stopped"));
  expect(queuedOn(store, "session_a")).toHaveLength(1);

  run("session_a").complete("The review agent is gone; still waiting.");
  expect(woken()).toHaveLength(1);
  expect(woken()[0]!.notification!.body).toContain("will not continue on its own");
  expect(children()[0]!.state).toBe("done");
});

test("the boot sweep ends a builder whose background work did not survive the restart", () => {
  const { run, task, reopen } = setup();
  task("session_a");
  const first = run("session_a");
  first.observe(started("task_review"));
  first.complete("Waiting on the review agent.");

  const fresh = reopen();
  fresh.recovery.recover();
  fresh.lineage.sweep();
  expect(queuedOn(fresh, "session_a").map((turn) => turn.notification?.body)).toEqual([expect.stringContaining("nothing is running in this session")]);
});

test("stopping a builder's background work ends it as stopped, without a nudge", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const first = run("session_a");
  first.observe(started("task_review"));
  first.complete("Waiting on the review agent.");
  store.worker.stopBackgroundTasks("session_a");

  expect(queuedOn(store, "session_a")).toEqual([]);
  expect(children()[0]).toMatchObject({ state: "stopped", summary: "its work was stopped" });
  expect(woken()).toHaveLength(1);
});

test("a turn cut off by a lost worker stays live through the grace, then ends the builder as stopped", () => {
  const { store, run, task, children, advance } = setup();
  task("session_a");
  run("session_a");
  store.recovery.retireWorkerRegistration("worker_session_a");
  store.lineage.sweep();
  expect(children()[0]!.state).toBe("working");

  advance(CUT_OFF_GRACE_MS);
  store.lineage.sweep();
  expect(children()[0]).toMatchObject({ state: "stopped", summary: "cut off when its worker went away" });
});

test("the old child registry is carried into the lineage once, and removed", () => {
  const { store, reopen } = setup();
  const record = { sessionId: "session_a", parentSessionId: HOST, state: "working", startedAt: 5 };
  store.intake.submitTurn("session_a", { runId: "run_queued", input: "go" });
  store.kernel.writeDocument(store.paths.children, { version: 1, children: [record] });

  const fresh = reopen();
  expect(fresh.lineageMigration).toBe(1);
  expect(fresh.lineage.childrenOf(HOST)).toEqual([expect.objectContaining({ sessionId: "session_a", state: "working" })]);
  expect(fresh.kernel.readDocument(fresh.paths.children)).toBeUndefined();
});

test("the nudge is only a safety net: a builder with its own builder out, or a delivery owed to it, is not nudged", () => {
  const { store, run, task, woken, children } = setup();
  task("session_a");
  const a = run("session_a");
  a.say("session_b", "task", "Write the tests.");
  a.complete("Waiting on session_b.");
  expect(queuedOn(store, "session_a")).toEqual([]);

  const b = run("session_b");
  b.say("session_a", "result", "Tests written.");
  b.complete();
  const delivered = queuedOn(store, "session_a");
  expect(delivered.map((turn) => turn.notification?.body)).toEqual([expect.stringContaining("[builder done]")]);

  run("session_a").complete("Noted; still thinking.");
  expect(queuedOn(store, "session_a").map((turn) => turn.notification?.body)).toEqual([expect.stringContaining("nothing is running in this session")]);
  run("session_a").complete("Still thinking.");
  expect(queuedOn(store, "session_a")).toEqual([]);
  expect(children()[0]).toMatchObject({ state: "done" });
  expect(woken()).toHaveLength(1);
});
