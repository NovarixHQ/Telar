import { afterEach, expect, test } from "bun:test";
import type { EngineStore } from "../../state";
import { busy, closeStores, reopenStore, reports, runTurn, setup } from "./notification-fixture";

afterEach(closeStores);

function parkRequest(store: EngineStore): string {
  store.intake.submitTurn("session_a", { runId: "run_a", input: "work" });
  const token = store.claims.claimTurn("session_a", "worker_child")!.claim!.token;
  store.turnLifecycle.markRunning("session_a", "run_a", token);
  store.lifecycle.updateSession("session_a", { runtimeMode: "approval-required" });
  store.requestGate.open("session_a", "run_a", token, {
    requestId: "req_one",
    kind: "user_input",
    detail: { kind: "user_input", prompt: "Which database?", fields: [{ key: "db", label: "Database", kind: "choice", choices: ["postgres"] }] },
  });
  return token;
}

const steered = (store: EngineStore) => store.queries.turns("session_host").filter((turn) => turn.state === "steering" && turn.wakeReason?.kind === "request_opened");

test("a request parked while the subscriber is busy goes into its running turn, not its mailbox", () => {
  const { store } = setup();
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_a" });
  busy(store);

  parkRequest(store);

  expect(steered(store).map((turn) => turn.wakeReason?.requestId)).toEqual(["req_one"]);
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);
});

test("a builder's parked request reaches a busy orchestrator at once", () => {
  const { store } = setup();
  store.children.recordMessage("session_a", "session_host", "task", { runId: "run_errand", body: "do it" });
  busy(store);

  parkRequest(store);

  expect(steered(store)).toHaveLength(1);
  expect(steered(store)[0]!.notification?.body).toContain("is WAITING on a request (request req_one");
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);
});

test("a run's ending at a busy subscriber is still held for the end of its turn", () => {
  const { store } = setup();
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_a", once: false });
  busy(store);
  const token = parkRequest(store);

  store.requestGate.resolve("session_a", "req_one", { decision: "accept", answers: { db: "postgres" } });
  store.turnLifecycle.completeTurn("session_a", "run_a", token, { text: "done" });

  expect(store.wakes.pendingNotifications("session_host").map((each) => each.wakeKind)).toEqual(["turn_completed"]);
});

const queuedNotices = (store: EngineStore) => store.queries.turns("session_host").filter((turn) => turn.state === "queued" && turn.wakeReason);

test("a queued wake is withdrawn once the subscriber reads that run itself; news about another run stays", () => {
  const { store } = setup();
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_a", once: false });
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_b", once: false });
  runTurn(store, "session_a", "run_a1");
  store.wakes.acknowledgeRead("session_host", "session_a", "run_a1");
  expect(queuedNotices(store)).toEqual([]);

  runTurn(store, "session_a", "run_a2");
  runTurn(store, "session_b", "run_b");
  expect(queuedNotices(store)).toHaveLength(1);
  store.wakes.acknowledgeRead("session_host", "session_a", "run_a1");
  expect(queuedNotices(store)[0]!.notification!.entries).toHaveLength(2);

  store.wakes.acknowledgeRead("session_host", "session_a", "run_a2");
  const [left] = queuedNotices(store);
  expect(left!.notification!.entries ?? [left!.notification!]).toMatchObject([{ sessionId: "session_b", runId: "run_b" }]);
  expect(left!.wakeReason).toMatchObject({ sessionId: "session_b", runId: "run_b" });
});

test("a held wake is withdrawn by the read too, and a parked request is not", () => {
  const { store } = setup();
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_a", once: false });
  busy(store);
  runTurn(store, "session_a", "run_done");
  expect(store.wakes.pendingNotifications("session_host")).toHaveLength(1);
  store.wakes.acknowledgeRead("session_host", "session_a", "run_done");
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);

  parkRequest(store);
  store.wakes.acknowledgeRead("session_host", "session_a", "run_a");
  expect(steered(store)).toHaveLength(1);
});

test("the mailbox sweep delivers a box a lost worker left behind, found on disk by a fresh engine", () => {
  const { store } = setup();
  store.subscriptions.subscribe("session_host", { targetSessionId: "session_a", once: true });
  busy(store);
  runTurn(store, "session_a", "run_a");
  store.recovery.retireWorkerRegistration("worker_host");
  expect(store.wakes.pendingNotifications("session_host")).toHaveLength(1);

  const fresh = reopenStore(store.paths.root);
  fresh.wakes.sweepMailboxes();
  expect(fresh.wakes.pendingNotifications("session_host")).toEqual([]);
  expect(queuedNotices(fresh).map((turn) => turn.wakeReason?.runId)).toEqual(["run_a"]);
});

const taskA = (store: EngineStore, from: { runId: string; token: string }) =>
  store.intake.submitAgentTurn("session_a", { runId: `run_task_${from.runId}`, input: "Build it.", intent: "task" }, { sessionId: "session_host", runId: from.runId, claimToken: from.token });

test("a builder's ending held while its orchestrator is busy wakes it as soon as that turn ends", () => {
  const { store } = setup();
  const host = busy(store);
  store.children.recordMessage("session_a", "session_host", "task", { runId: "run_errand", body: "do it" });
  reports(store, { runId: "run_build" });
  expect(store.wakes.pendingNotifications("session_host").map((each) => each.summary)).toEqual([expect.stringContaining("[builder done]")]);

  store.turnLifecycle.completeTurn("session_host", host.runId, host.token, { text: "still in progress" });

  expect(queuedNotices(store).map((turn) => turn.notification?.body)).toEqual([expect.stringContaining("[builder done]")]);
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);
});

test("a result from a builder whose record already ended still wakes its orchestrator", () => {
  const { store } = setup();
  const first = busy(store);
  taskA(store, first);
  const child = store.claims.claimTurn("session_a", "worker_child")!;
  store.turnLifecycle.markRunning("session_a", child.runId, child.claim!.token);
  store.turnLifecycle.completeTurn("session_a", child.runId, child.claim!.token, { text: "rebasing, back soon" });
  store.turnLifecycle.completeTurn("session_host", first.runId, first.token, { text: "ok" });
  expect(store.children.childrenOf("session_host").map((each) => each.state)).toEqual(["done"]);
  const wake = store.claims.claimTurn("session_host", "worker_host")!;
  store.turnLifecycle.markRunning("session_host", wake.runId, wake.claim!.token);
  store.turnLifecycle.completeTurn("session_host", wake.runId, wake.claim!.token, { text: "noted" });

  const second = busy(store, "run_host_two");
  const late = reports(store, { runId: "run_late", sent: "PR #12 is green." });
  store.turnLifecycle.completeTurn("session_host", second.runId, second.token, { text: "still in progress" });

  expect(late.sent.agentDelivery).toBe("wake");
  expect(store.queries.turns("session_host").filter((turn) => turn.state === "queued").map((turn) => turn.runId)).toEqual([late.sent.runId]);
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);
});

test("a person's message steered into a busy orchestrator brings the endings held for it", () => {
  const { store } = setup();
  const host = busy(store);
  store.children.recordMessage("session_a", "session_host", "task", { runId: "run_errand", body: "do it" });
  reports(store);
  expect(store.wakes.pendingNotifications("session_host")).toHaveLength(1);

  store.intake.submitTurn("session_host", { runId: "run_person", input: "how are the builders doing?" });

  const steering = store.queries.turns("session_host").filter((turn) => turn.state === "steering" && turn.steer?.intoRunId === host.runId);
  expect(steering.map((turn) => turn.runId)).toContain("run_person");
  expect(steering.find((turn) => turn.notification)?.notification?.body).toContain("[builder done]");
  expect(store.wakes.pendingNotifications("session_host")).toEqual([]);
});
