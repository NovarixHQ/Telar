import { afterEach, expect, test } from "bun:test";
import type { EngineStore } from "../../state";
import { closeStores, reopenStore, setup } from "./notification-fixture";

afterEach(closeStores);

const HOST = "session_host";
let runs = 0;

function run(store: EngineStore, sessionId: string) {
  if (!store.queries.turns(sessionId).some((turn) => turn.state === "queued")) store.intake.submitTurn(sessionId, { runId: `run_${sessionId}_${++runs}`, input: "go" });
  const claimed = store.claims.claimTurn(sessionId, `worker_${sessionId}`)!;
  const token = claimed.claim!.token;
  store.turnLifecycle.markRunning(sessionId, claimed.runId, token);
  const proof = { sessionId, runId: claimed.runId, claimToken: token };
  return {
    runId: claimed.runId,
    say: (to: string, intent: "task" | "result", input: string) => store.intake.submitAgentTurn(to, { runId: `run_say_${++runs}`, input, intent }, proof).turn,
    complete: (text = "finished") => store.turnLifecycle.completeTurn(sessionId, claimed.runId, token, { text }),
  };
}

function tasked(store: EngineStore, ...children: string[]) {
  const host = run(store, HOST);
  for (const child of children) host.say(child, "task", `Do ${child}.`);
  host.complete();
}

const told = (turn: { state: string; startedAt?: number }) => turn.state !== "discarded" && !(turn.state === "stopped" && turn.startedAt === undefined);
const endingsTold = (store: EngineStore) =>
  store.queries.turns(HOST)
    .filter((turn) => told(turn) && turn.agentDelivery !== "passive" && turn.wakeReason)
    .flatMap((turn) => (turn.notification?.entries ?? []).filter((entry) => entry.title !== undefined).map((entry) => entry.sessionId));
const wakesOnHost = (store: EngineStore) => store.queries.turns(HOST).filter((turn) => told(turn) && turn.agentDelivery !== "passive" && turn.wakeReason);

for (const always of [false, true]) {
  const label = always ? "with" : "without";

  test(`a builder's result reaches an idle parent exactly once, ${label} an every-completion subscription`, () => {
    const { store } = setup();
    tasked(store, "session_a");
    if (always) store.subscriptions.subscribe(HOST, { targetSessionId: "session_a", completionWake: "always", once: false });
    const a = run(store, "session_a");
    a.say(HOST, "result", "PR #9 merged.");
    a.complete();
    expect(endingsTold(store)).toEqual(["session_a"]);
    expect(wakesOnHost(store)).toHaveLength(1);
  });

  test(`a builder's result reaches a busy parent exactly once, after its turn, ${label} an every-completion subscription`, () => {
    const { store } = setup();
    tasked(store, "session_a");
    if (always) store.subscriptions.subscribe(HOST, { targetSessionId: "session_a", completionWake: "always", once: false });
    const host = run(store, HOST);
    const a = run(store, "session_a");
    a.say(HOST, "result", "PR #9 merged.");
    a.complete();
    expect(endingsTold(store)).toEqual([]);

    host.complete();
    expect(endingsTold(store)).toEqual(["session_a"]);
    run(store, HOST).complete();
    expect(endingsTold(store)).toEqual(["session_a"]);
  });
}

test("sibling endings while the parent works become one wake when its turn ends", () => {
  const { store } = setup();
  tasked(store, "session_a", "session_b");
  const host = run(store, HOST);
  for (const child of ["session_a", "session_b"]) {
    const builder = run(store, child);
    builder.say(HOST, "result", `${child} done.`);
    builder.complete();
  }
  host.complete();
  expect(wakesOnHost(store)).toHaveLength(1);
  expect(endingsTold(store).sort()).toEqual(["session_a", "session_b"]);
});

test("an ending arriving while the parent's wake is still queued joins that wake", () => {
  const { store } = setup();
  tasked(store, "session_a", "session_b");
  for (const child of ["session_a", "session_b"]) {
    const builder = run(store, child);
    builder.say(HOST, "result", `${child} done.`);
    builder.complete();
  }
  expect(wakesOnHost(store)).toHaveLength(1);
  expect(endingsTold(store).sort()).toEqual(["session_a", "session_b"]);
});

test("a parent that reads the result itself is not woken for it", () => {
  const { store } = setup();
  tasked(store, "session_a");
  const host = run(store, HOST);
  const a = run(store, "session_a");
  const result = a.say(HOST, "result", "PR #9 merged.");
  a.complete();
  store.wakes.acknowledgeRead(HOST, HOST, result.runId);
  host.complete();
  expect(wakesOnHost(store)).toEqual([]);
  expect(store.wakes.pendingNotifications(HOST)).toEqual([]);
});

test("a read withdraws an ending already queued as a wake", () => {
  const { store } = setup();
  tasked(store, "session_a");
  const a = run(store, "session_a");
  const result = a.say(HOST, "result", "PR #9 merged.");
  a.complete();
  expect(wakesOnHost(store)).toHaveLength(1);
  store.wakes.acknowledgeRead(HOST, HOST, result.runId);
  expect(wakesOnHost(store)).toEqual([]);
});

test("a restart with the wake still queued delivers it once; a wake that never ran is delivered again, once", () => {
  const { store } = setup();
  tasked(store, "session_a");
  const a = run(store, "session_a");
  a.say(HOST, "result", "PR #9 merged.");
  a.complete();

  const fresh = reopenStore(store.paths.root);
  fresh.recovery.recover();
  fresh.lineage.sweep();
  expect(wakesOnHost(fresh)).toHaveLength(1);
  const [wake] = wakesOnHost(fresh);
  fresh.turnLifecycle.stopTurn(HOST, wake!.runId);
  fresh.lineage.sweep();
  expect(endingsTold(fresh)).toEqual(["session_a"]);
  expect(wakesOnHost(fresh).filter((turn) => turn.state === "queued")).toHaveLength(1);

  run(fresh, HOST).complete();
  fresh.lineage.sweep();
  expect(endingsTold(fresh)).toEqual(["session_a"]);
});
