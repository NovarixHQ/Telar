import { afterEach, expect, test } from "bun:test";
import type { EngineStore } from "../../state";
import { busy, closeStores, reopenStore, runTurn, setup } from "./notification-fixture";

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

test("a cohort member's parked request reaches a busy orchestrator at once", () => {
  const { store } = setup();
  store.subscriptions.subscribeCohort("session_host", { sessionIds: ["session_a", "session_b"] });
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
