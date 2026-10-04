/**
 * The queue on the read and write paths: one row per turn (#547, then rows).
 * The counters are exact on purpose, so a change that moves them is looked at.
 * Validate on write, trust on read: each refusal has a sibling acceptance.
 */
import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";
import { ExecutionStore } from "../../platform/db/execution-store";
import { toLegacyHome } from "../../../test/store-internals";
import type { Turn } from "@telar/engine-client";
import { sessionSnapshot } from "./bootstrap";
import { SessionQueues } from "./queue";

const roots: string[] = [];
const stores: EngineStore[] = [];

const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-queue-write-"));
  roots.push(directory);
  fs.writeFileSync(path.join(directory, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  return directory;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.kernel.executionStore.close(); } catch { /* the test closed it itself */ }
  }
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** A clock that moves, so `activityAt` and `lastTurnEndedAt` are distinguishable. */
function open(directory: string, now?: () => number): EngineStore {
  let clock = 1_000;
  const store = new EngineStore(directory, now ?? (() => (clock += 1)));
  stores.push(store);
  return store;
}

function seeded(store: EngineStore, turns: number, sessionId = "session_one"): EngineStore {
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  store.lifecycle.createSession({ id: sessionId, projectId: "project_one" });
  for (let n = 0; n < turns; n += 1) {
    const runId = `run_seed_${n}`;
    store.intake.submitTurn(sessionId, { runId, input: `message ${n}` });
    const token = store.claims.claimTurn(sessionId, "worker_one")!.claim!.token;
    store.turnLifecycle.markRunning(sessionId, runId, token);
    store.turnLifecycle.completeTurn(sessionId, runId, token, { text: `answer ${n}` });
  }
  return store;
}

/** Turn rows read during `action`, whatever the route. */
function rowsRead(store: EngineStore, action: () => void): number {
  const before = store.kernel.readAccounting.turnRows;
  action();
  return store.kernel.readAccounting.turnRows - before;
}

/** Closes `store` so the next `open` of its home starts with nothing cached. */
function reopen(store: EngineStore): void {
  store.kernel.executionStore.close();
  stores.splice(stores.indexOf(store), 1);
}

/** Whole-queue parses made by `action`, which is the number #547 is about. */
function queueParses(store: EngineStore, action: () => void): number {
  const before = store.kernel.readAccounting.queueParses;
  action();
  return store.kernel.readAccounting.queueParses - before;
}

test("a whole-queue read is accounted for, rows and bytes", () => {
  const directory = root();
  reopen(seeded(open(directory), 4));
  const store = open(directory);
  store.kernel.readAccounting.documentBytes = 0;
  store.kernel.readAccounting.documentReads = 0;
  store.kernel.readAccounting.queueParses = 0;
  store.kernel.readAccounting.turnRows = 0;
  const turns = store.queries.turns("session_one");

  expect(store.kernel.readAccounting.documentReads).toBe(1);
  expect(store.kernel.readAccounting.queueParses).toBe(1);
  expect(store.kernel.readAccounting.turnRows).toBe(4);
  expect(store.kernel.readAccounting.documentBytes).toBe(turns.map((turn) => JSON.stringify(turn)).join("").length);
});

test("a legacy session whose queue document is missing reads as empty", () => {
  const directory = root();
  toLegacyHome(seeded(open(directory), 1), directory);
  expect(fs.existsSync(path.join(directory, "sessions", "session_one", "queue.json"))).toBe(true);
  fs.rmSync(path.join(directory, "sessions", "session_one", "queue.json"));
  const store = open(directory);
  store.kernel.readAccounting.documentReads = 0;
  store.kernel.readAccounting.queueParses = 0;
  expect(store.queries.turns("session_one")).toEqual([]);
  expect(store.kernel.readAccounting.documentReads).toBe(0);
  expect(store.kernel.readAccounting.queueParses).toBe(0);
});

// ── a write stores the turns it changed, and nothing else ────────────────────

/** The turn rows each `writeTurnRows` call stored during `action`. */
function rowWrites(store: EngineStore, action: () => void): number[] {
  const execution = store.kernel.executionStore;
  const original = execution.writeTurnRows.bind(execution);
  const writes: number[] = [];
  execution.writeTurnRows = (sessionId, next, rows) => {
    writes.push(rows.length);
    original(sessionId, next, rows);
  };
  try { action(); } finally { execution.writeTurnRows = original; }
  return writes;
}

test("each turn transition writes one row, however long the queue", () => {
  const store = seeded(open(root()), 40);
  let token = "";
  expect(rowWrites(store, () => store.intake.submitTurn("session_one", { runId: "run_x", input: "hello" }))).toEqual([1]);
  expect(rowWrites(store, () => { token = store.claims.claimTurn("session_one", "worker_one")!.claim!.token; })).toEqual([1]);
  expect(rowWrites(store, () => store.turnLifecycle.markRunning("session_one", "run_x", token))).toEqual([1]);
  expect(rowWrites(store, () => store.turnLifecycle.completeTurn("session_one", "run_x", token, { text: "done" }))).toEqual([1]);
  expect(store.queries.turns("session_one")).toHaveLength(41);
});

test("a metadata write reads no whole queue to refold the row", () => {
  const store = seeded(open(root()), 5);
  expect(queueParses(store, () => store.lifecycle.updateSession("session_one", { title: "Renamed" }))).toBe(0);
  expect(rowWrites(store, () => store.lifecycle.updateSession("session_one", { title: "Again" }))).toEqual([]);
});

test("the carried queue is the one the command wrote, at every transition", () => {
  // A pass-through that carried a STALE queue would keep the parse count at
  // 5/4/2/4 and put a wrong pill on the rail, so the folded row is pinned at
  // every transition. The clock only moves by hand.
  let clock = 1_000;
  const store = seeded(open(root(), () => clock), 3);

  const folded = (): unknown => {
    const row = store.live.rows({ all: true }).sessions.find((session) => session.id === "session_one")!;
    return {
      activity: row.activity,
      activityAt: row.activityAt,
      lastTurnEndedAt: row.lastTurnEndedAt,
      lastTurnFailed: row.lastTurnFailed,
      lastTurnSequence: row.lastTurnSequence,
    };
  };
  const idle = (endedAt: number, sequence: number) =>
    ({ activity: "idle", activityAt: undefined, lastTurnEndedAt: endedAt, lastTurnFailed: undefined, lastTurnSequence: sequence });
  const busy = (activity: string, at: number) =>
    ({ activity, activityAt: at, lastTurnEndedAt: 1_000, lastTurnFailed: undefined, lastTurnSequence: 3 });

  expect(folded()).toEqual(idle(1_000, 3));
  const step = (action: () => void, expected: unknown): void => {
    clock += 10;
    action();
    expect(folded()).toEqual(expected);
  };

  let token = "";
  step(() => store.intake.submitTurn("session_one", { runId: "run_x", input: "hello" }), busy("queued", 1_010));
  step(() => { token = store.claims.claimTurn("session_one", "worker_one")!.claim!.token; }, busy("queued", 1_010));
  step(() => store.turnLifecycle.markRunning("session_one", "run_x", token), busy("working", 1_030));
  step(() => store.turnLifecycle.completeTurn("session_one", "run_x", token, { text: "done" }), idle(1_040, 4));
  // A metadata-only write must not disturb what the queue write folded.
  step(() => store.lifecycle.updateSession("session_one", { title: "Renamed" }), idle(1_040, 4));
});

// ── step 3: validate on write, trust on read, refuse either way ──────────────

/** A turn that satisfies the structural guard and violates `Turn`. */
const malformedTurn = (sessionId: string, sequence: number): Record<string, unknown> => ({
  runId: "run_bad",
  sessionId,
  sequence,
  state: "completed",
  // `input` is `z.string()`. A number passes the four structural fields and
  // fails the schema, which is exactly the gap trust-on-read opens.
  input: 42,
  acceptedAt: 1,
  updatedAt: 1,
});

/** Rewrite a session as a store from before turns were rows: an exact `queue.json`, and no rows. */
function injectQueue(directory: string, sessionId: string, document: unknown): void {
  const raw = new ExecutionStore(directory);
  try {
    raw.transaction("test-inject", () => {
      raw.writeText(path.join(directory, "sessions", sessionId, "queue.json"), JSON.stringify(document));
      raw.statement("DELETE FROM turns WHERE session_id=?").run(sessionId);
      raw.statement("DELETE FROM metadata WHERE key=?").run(`queue-rows/${sessionId}`);
    });
  } finally {
    raw.close();
  }
}

const bareQueues = (store: EngineStore) => new SessionQueues(store.kernel, { sessionIds: () => ["session_one"], itemsForRuns: () => [], afterWrite: () => {} });

test("a malformed turn is read, but a write that changes it is refused", () => {
  // Only changed rows are validated: an untouched bad row is carried, never rewritten.
  const directory = root();
  const first = seeded(open(directory), 2);
  const seededTurns = first.queries.turns("session_one");
  reopen(first);
  injectQueue(directory, "session_one", { version: 2, sessionId: "session_one", nextSequence: 9, turns: [...seededTurns, malformedTurn("session_one", 8)] });

  const store = open(directory);
  expect(store.queries.turns("session_one").map((turn) => turn.runId)).toEqual(["run_seed_0", "run_seed_1", "run_bad"]);
  const queues = bareQueues(store);
  const touched = queues.read("session_one", ["run_bad"]);
  touched.turns[0]!.updatedAt = 2;
  expect(() => queues.write("session_one", touched)).toThrow(/invalid session queue/);
  const fixed = queues.read("session_one", ["run_bad"]);
  fixed.turns[0] = { ...seededTurns[0]!, runId: "run_bad", sequence: 8 };
  queues.write("session_one", fixed);
  expect(open(directory).queries.turns("session_one")[2]).toEqual(fixed.turns[0]!);
});

test("a structurally broken turn is refused on read", () => {
  // The four fields every reader keys on are still checked, so a document a
  // downgrade or a migration left behind fails as "invalid session queue"
  // rather than as an `undefined` on the rail.
  const directory = root();
  const first = seeded(open(directory), 2);
  const turns = first.queries.turns("session_one");
  reopen(first);

  for (const broken of [
    { ...turns[0]!, runId: undefined },
    { ...turns[0]!, sessionId: 7 },
    { ...turns[0]!, sequence: "second" },
    { ...turns[0]!, state: "mid-flight" },
  ]) {
    injectQueue(directory, "session_one", { version: 2, sessionId: "session_one", nextSequence: 3, turns: [broken] });
    const store = open(directory);
    expect(() => store.queries.turns("session_one")).toThrow(/invalid session queue/);
    reopen(store);
  }

  // AND THE SAME ROW, INTACT, READS FINE — four refusals mean nothing without
  // this line.
  injectQueue(directory, "session_one", { version: 2, sessionId: "session_one", nextSequence: 3, turns: [turns[0]!] });
  expect(open(directory).queries.turns("session_one")).toEqual([turns[0]!]);
});

test("the scan cache keeps live queues and only the most recently scanned idle ones", () => {
  const store = open(root());
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  const ids = Array.from({ length: 100 }, (_, n) => `session_${n}`);
  for (const id of ids) store.lifecycle.createSession({ id, projectId: "project_one" });
  store.intake.submitTurn("session_0", { runId: "run_live", input: "hello" });
  const queues = new SessionQueues(store.kernel, { sessionIds: () => ids, itemsForRuns: () => [], afterWrite: () => {} });
  expect([...queues.liveSessionIds()]).toEqual(["session_0"]);
  for (const id of ids) queues.scan(id);
  // A cache miss asks the store for the queue's head; a hit asks nothing.
  const execution = store.kernel.executionStore;
  const head = execution.queueNextSequence.bind(execution);
  const loads = (action: () => void): number => {
    let count = 0;
    execution.queueNextSequence = (sessionId) => { count += 1; return head(sessionId); };
    try { action(); } finally { execution.queueNextSequence = head; }
    return count;
  };

  expect(loads(() => queues.scan("session_0"))).toBe(0);
  expect(loads(() => { for (const id of ids.slice(-32)) queues.scan(id); })).toBe(0);
  expect(loads(() => queues.scan("session_1"))).toBe(1);
});

test("a cold live-queue build reads the live queues only, however long the history", () => {
  const directory = root();
  const store = seeded(open(directory), 1);
  const ids = ["session_one"];
  for (let n = 0; n < 60; n += 1) {
    const id = `session_done_${n}`;
    ids.push(id);
    seeded(store, 1, id);
  }
  store.lifecycle.createSession({ id: "session_queued", projectId: "project_one" });
  store.intake.submitTurn("session_queued", { runId: "run_queued", input: "hello" });
  store.lifecycle.createSession({ id: "session_stopped", projectId: "project_one" });
  store.intake.submitTurn("session_stopped", { runId: "run_stopped", input: "hello" });
  store.claims.claimTurn("session_stopped", "worker_one");
  store.turnLifecycle.stopTurn("session_stopped", "run_stopped");
  ids.push("session_queued", "session_stopped");
  const queues = (on: EngineStore) => new SessionQueues(on.kernel, { sessionIds: () => ids, itemsForRuns: () => [], afterWrite: () => {} });

  let first: Set<string> = new Set();
  // Every session is asked, and only live rows come back.
  expect(rowsRead(store, () => { first = queues(store).liveSessionIds(); })).toBe(2);
  expect([...first].sort()).toEqual(["session_queued", "session_stopped"]);
  reopen(store);

  const reopened = open(directory);
  let cold: Set<string> = new Set();
  expect(rowsRead(reopened, () => { cold = queues(reopened).liveSessionIds(); })).toBe(2);
  expect([...cold].sort()).toEqual(["session_queued", "session_stopped"]);

  const token = reopened.claims.claimTurn("session_queued", "worker_two")!.claim!.token;
  reopened.turnLifecycle.markRunning("session_queued", "run_queued", token);
  reopened.turnLifecycle.completeTurn("session_queued", "run_queued", token, { text: "done" });
  expect([...queues(reopened).liveSessionIds()]).toEqual(["session_stopped"]);
});

// ── a long history: migrated from its document, then read by the window ──────

const STATES = ["completed", "failed", "stopped", "discarded", "ambiguous", "steered"] as const;

/** A legacy `queue.json` of `count` settled turns in every terminal state, plus one queued and one running. */
function longHistory(directory: string, count: number): { turns: Turn[]; nextSequence: number } {
  const first = seeded(open(directory), 1);
  const shape = first.queries.turns("session_one")[0]!;
  reopen(first);
  const { claim: _claim, completedAt: _completed, resultText: _result, ...open_ } = shape;
  // A settled turn's claim is released; a stopped one keeping it would still concern a worker.
  const turns: Turn[] = Array.from({ length: count }, (_, n) => ({
    ...open_, runId: `run_${n}`, sequence: n + 1, state: STATES[n % STATES.length]!, input: `message ${n}`, resultText: `answer ${n}`,
    completedAt: 2_000 + n, updatedAt: 2_000 + n,
  }));
  turns.push({ ...open_, runId: "run_queued", sequence: count + 1, state: "queued", input: "next", updatedAt: 9_000 });
  turns.push({ ...shape, runId: "run_running", sequence: count + 2, state: "running", input: "now", completedAt: undefined, resultText: undefined, updatedAt: 9_001 });
  const nextSequence = count + 7;
  injectQueue(directory, "session_one", { version: 2, sessionId: "session_one", nextSequence, turns });
  return { turns, nextSequence };
}

test("migrating a queue.json keeps every turn, its state and the next sequence, and drops the document", () => {
  const directory = root();
  const { turns, nextSequence } = longHistory(directory, 300);
  const store = open(directory);
  expect(store.queries.turns("session_one")).toEqual(turns);
  expect(store.kernel.readDocument(path.join(directory, "sessions", "session_one", "queue.json"))).toBeUndefined();

  store.intake.submitTurn("session_one", { runId: "run_after", input: "after" });
  expect(store.queries.turns("session_one").at(-1)!.sequence).toBe(nextSequence);
  reopen(store);
  expect(open(directory).queries.turns("session_one")).toHaveLength(turns.length + 1);
});

test("a snapshot of a 5,000-turn session reads the window and the live turns, not the history", () => {
  const directory = root();
  const { turns } = longHistory(directory, 5_000);
  const store = open(directory);
  store.queries.turns("session_one");
  reopen(store);

  const cold = open(directory);
  let snapshot!: ReturnType<typeof sessionSnapshot>;
  const rows = rowsRead(cold, () => { snapshot = sessionSnapshot(cold, "session_one", { turns: 20 }); });
  expect(snapshot.turns.map((turn) => turn.runId)).toEqual([...turns.slice(4_980, 5_000), ...turns.slice(5_000)].map((turn) => turn.runId));
  expect(snapshot.session.activity).toBe("working");
  expect(snapshot.session.lastTurnEndedAt).toBe(2_000 + 4_999);
  // 20 settled + 2 active for the window, and the activity fold's live and last-ended rows.
  expect(rows).toBeLessThanOrEqual(30);
  expect(cold.kernel.readAccounting.queueParses).toBe(0);
}, 60_000);

// ── a mutation reads the open turns and the one it names, not the history ────

type Costs = Record<string, { rows: number; parses: number }>;

/** Turn rows read and whole queues parsed by each mutation, on a cold store over `length` settled turns. */
function mutationCosts(length: number): { costs: Costs; states: string[][] } {
  const directory = root();
  const first = seeded(open(directory), 1);
  const { claim: _claim, ...shape } = first.queries.turns("session_one")[0]!;
  reopen(first);
  const history = Array.from({ length }, (_, n) => ({
    ...shape, runId: `run_${n}`, sequence: n + 1, input: `message ${n}`, resultText: `answer ${n}`, completedAt: 2_000 + n, updatedAt: 2_000 + n,
  }));
  injectQueue(directory, "session_one", { version: 2, sessionId: "session_one", nextSequence: length + 1, turns: history });
  const migrating = open(directory);
  migrating.queries.turns("session_one");
  reopen(migrating);

  const store = open(directory);
  const costs: Costs = {};
  const measure = (name: string, action: () => void): void => {
    const parses = store.kernel.readAccounting.queueParses;
    costs[name] = { rows: rowsRead(store, action), parses: store.kernel.readAccounting.queueParses - parses };
  };
  const claim = (): string => store.claims.claimTurn("session_one", "worker_one")!.claim!.token;
  let token = "";
  measure("submit", () => store.intake.submitTurn("session_one", { runId: "run_a", input: "a" }));
  measure("claim", () => { token = claim(); });
  measure("submit behind a claim", () => store.intake.submitTurn("session_one", { runId: "run_c", input: "c" }));
  measure("cancel a queued turn", () => store.turnLifecycle.stopTurn("session_one", "run_c"));
  measure("start", () => store.turnLifecycle.markRunning("session_one", "run_a", token));
  measure("steer", () => store.intake.submitTurn("session_one", { runId: "run_b", input: "b" }));
  measure("ack the steer", () => store.turnLifecycle.ackSteer("session_one", "run_b", token));
  measure("complete", () => store.turnLifecycle.completeTurn("session_one", "run_a", token, { text: "done" }));
  measure("mark read", () => store.records.markRead("session_one", "run_a"));
  store.intake.submitTurn("session_one", { runId: "run_d", input: "d" });
  token = claim();
  store.turnLifecycle.markRunning("session_one", "run_d", token);
  measure("fail", () => store.turnLifecycle.failTurn("session_one", "run_d", token, { code: "rate_limited", message: "limit", resumeAt: 1 }));
  measure("retry", () => store.turnLifecycle.resumeRateLimitedTurn("session_one", "run_d"));
  measure("stop the session", () => store.turnLifecycle.stopSession("session_one"));
  return { costs, states: store.queries.turns("session_one").slice(length).map((turn) => [turn.runId, turn.state]) };
}

test("a queue mutation costs the same on a 5,000-turn session as on a 10-turn one, and parses no whole queue", () => {
  const long = mutationCosts(5_000);
  expect(long.costs).toEqual(mutationCosts(10).costs);
  expect(Object.values(long.costs).every((cost) => cost.parses === 0 && cost.rows <= 30)).toBe(true);
  expect(long.states).toEqual([["run_a", "completed"], ["run_c", "stopped"], ["run_b", "steered"], ["run_d", "stopped"]]);
}, 60_000);
