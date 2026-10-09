import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";
import { EngineStateError } from "../../platform/kernel";

const roots: string[] = [];
afterEach(() => {
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function queueingStore(whileWorking: "steer" | "queue" = "queue"): EngineStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-queued-"));
  roots.push(directory);
  const store = new EngineStore(directory, () => 100);
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  store.lifecycle.createSession({ id: "session_one", projectId: "project_one" });
  store.settings.setSessionDefaults({ whileWorking });
  return store;
}

function running(store: EngineStore, runId = "run_live"): string {
  store.intake.submitTurn("session_one", { runId, input: "Long task" });
  const claimed = store.claims.claimTurn("session_one", "worker_one")!;
  store.turnLifecycle.markRunning("session_one", runId, claimed.claim!.token);
  return claimed.claim!.token;
}

const queued = (store: EngineStore): string[] =>
  store.queries.turns("session_one").filter((turn) => turn.state === "queued").sort((a, b) => a.sequence - b.sequence).map((turn) => turn.input);

test("the setting decides whether a mid-turn message steers or waits", () => {
  const steering = queueingStore("steer");
  running(steering);
  expect(steering.intake.submitTurn("session_one", { runId: "run_next", input: "Also" }).turn.state).toBe("steering");

  const queueing = queueingStore("queue");
  running(queueing);
  expect(queueing.intake.submitTurn("session_one", { runId: "run_next", input: "Also" }).turn.state).toBe("queued");
});

test("a message sent between claim and start waits too", () => {
  const store = queueingStore();
  store.intake.submitTurn("session_one", { runId: "run_live", input: "Long task" });
  const claimed = store.claims.claimTurn("session_one", "worker_one")!;
  store.intake.submitTurn("session_one", { runId: "run_next", input: "Also" });
  store.turnLifecycle.markRunning("session_one", "run_live", claimed.claim!.token);
  expect(queued(store)).toEqual(["Also"]);
});

test("queued messages run in order, the next one claimed when the turn ends", () => {
  const store = queueingStore();
  const token = running(store);
  store.intake.submitTurn("session_one", { runId: "run_a", input: "First" });
  store.intake.submitTurn("session_one", { runId: "run_b", input: "Second" });
  store.turnLifecycle.completeTurn("session_one", "run_live", token, { text: "done" });
  expect(store.claims.claimTurn("session_one", "worker_one")?.runId).toBe("run_a");
  expect(queued(store)).toEqual(["Second"]);
});

test("send now steers a queued message into the running turn", () => {
  const store = queueingStore();
  running(store);
  store.intake.submitTurn("session_one", { runId: "run_a", input: "First" });
  expect(store.turnLifecycle.promoteTurn("session_one", "run_a")).toMatchObject({ state: "steering", steer: { intoRunId: "run_live" } });
});

test("a queued message can be edited, reordered and removed", () => {
  const store = queueingStore();
  running(store);
  for (const [runId, input] of [["run_a", "A"], ["run_b", "B"], ["run_c", "C"]] as const) store.intake.submitTurn("session_one", { runId, input });

  store.queuedTurns.editQueuedTurn("session_one", "run_b", "B, edited");
  expect(queued(store)).toEqual(["A", "B, edited", "C"]);

  store.queuedTurns.moveQueuedTurn("session_one", "run_c", "run_a");
  expect(queued(store)).toEqual(["C", "A", "B, edited"]);
  store.queuedTurns.moveQueuedTurn("session_one", "run_c", null);
  expect(queued(store)).toEqual(["A", "B, edited", "C"]);

  store.turnLifecycle.stopTurn("session_one", "run_a");
  expect(queued(store)).toEqual(["B, edited", "C"]);
});

test("only a waiting message can be changed", () => {
  const store = queueingStore();
  running(store);
  expect(() => store.queuedTurns.editQueuedTurn("session_one", "run_live", "x")).toThrow(EngineStateError);
  store.intake.submitTurn("session_one", { runId: "run_a", input: "A" });
  expect(() => store.queuedTurns.editQueuedTurn("session_one", "run_a", "  ")).toThrow(/non-empty/);
  expect(() => store.queuedTurns.moveQueuedTurn("session_one", "run_a", "run_live")).toThrow(EngineStateError);
});
