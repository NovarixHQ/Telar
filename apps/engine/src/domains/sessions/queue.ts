import path from "node:path";
import { Turn, TurnState, type Item } from "@telar/engine-client";
import type { ExecutionStore } from "../../platform/db/execution-store";
import {
  activityTurnRows, allTurnRows, assignedTurnRows, liveTurnRows, turnRowsFor, turnWindowRows, type TurnRow,
} from "../../platform/db/turn-rows";
import { assertId, assertStateVersion, EngineStateError, STATE_VERSION, type Kernel } from "../../platform/kernel";
import type { EngineStatePaths } from "../../platform/fs/state-paths";
import { summariseTurn } from "../turns";
import { sessionDir } from "./metadata";

export type SessionQueue = { version: typeof STATE_VERSION; sessionId: string; nextSequence: number; turns: Turn[] };

const FOLDED_TURNS_LIMIT = 8;
const SCANNED_IDLE_QUEUES_LIMIT = 32;

export const emptyQueue = (sessionId: string): SessionQueue => ({ version: STATE_VERSION, sessionId, nextSequence: 1, turns: [] });

function sessionQueueFile(paths: EngineStatePaths, sessionId: string): string {
  return path.join(sessionDir(paths, sessionId), "queue.json");
}

function sessionQueueIndexFile(paths: EngineStatePaths, sessionId: string): string {
  return path.join(sessionDir(paths, sessionId), "queue.index.json");
}

// The four fields every reader keys on; a property check per row, not a schema walk.
function isTurnRow(row: unknown): row is Turn {
  if (typeof row !== "object" || row === null) return false;
  const candidate = row as Partial<Turn>;
  return typeof candidate.runId === "string" && typeof candidate.sessionId === "string"
    && Number.isSafeInteger(candidate.sequence) && TurnState.safeParse(candidate.state).success;
}

/** Rows `write` validated get the structural guard only. */
function parseTurns(rows: readonly string[]): Turn[] {
  return rows.map((text) => {
    const turn: unknown = JSON.parse(text);
    if (!isTurnRow(turn)) throw new EngineStateError("invalid_request", "invalid session queue");
    return turn;
  });
}

/** A `queue.json` from before turns were rows, which the store validated when it wrote it. */
function parseQueue(value: unknown, sessionId: string): SessionQueue {
  assertStateVersion(value, "session queue");
  const stored = value as { sessionId?: unknown; nextSequence?: unknown; turns?: unknown };
  if (stored.sessionId !== sessionId || !Number.isSafeInteger(stored.nextSequence) || !Array.isArray(stored.turns)
    || stored.turns.some((row) => !isTurnRow(row))) {
    throw new EngineStateError("invalid_request", "invalid session queue");
  }
  const rows = stored.turns as Turn[];
  const ids = new Set<string>();
  for (const turn of rows) {
    assertId(turn.runId, "run id");
    if (ids.has(turn.runId)) throw new EngineStateError("invalid_request", "duplicate Telar turn id");
    ids.add(turn.runId);
  }
  return { version: STATE_VERSION, sessionId, nextSequence: stored.nextSequence as number, turns: rows };
}

/** A failed turn the rate-limit sweep has not yet decided about. */
export function awaitsRateLimitSweep(turn: Turn): boolean {
  return (
    turn.state === "failed" &&
    turn.failure?.code === "rate_limited" &&
    turn.failure.resumeAt !== undefined &&
    turn.failure.resumeDecidedAt === undefined
  );
}

/**
 * Whether a worker could have business with this turn: the union of what a
 * claim, the heartbeat and the rate-limit sweep read. A stopped turn keeps its
 * claim, which is how a worker learns of a Stop.
 */
function turnConcernsAWorker(turn: Turn): boolean {
  return (
    turn.state === "queued" ||
    turn.state === "claimed" ||
    turn.state === "running" ||
    turn.state === "steering" ||
    (turn.state === "stopped" && turn.claim !== undefined) ||
    awaitsRateLimitSweep(turn)
  );
}

function turnRow(turn: Turn, value: string): TurnRow {
  return {
    runId: turn.runId,
    sequence: turn.sequence,
    state: turn.state,
    acceptedAt: turn.acceptedAt,
    updatedAt: turn.updatedAt,
    ...(turn.completedAt === undefined ? {} : { completedAt: turn.completedAt }),
    live: turnConcernsAWorker(turn),
    assigned: turn.origin === "session" && turn.agentIntent === "task" && turn.sender?.sessionId !== undefined,
    value,
  };
}

type QueueDeps = {
  sessionIds: () => string[];
  itemsForRuns: (sessionId: string, runs: Set<string>) => Item[];
  afterWrite: (sessionId: string, turns: Turn[]) => void;
  onChanged?: () => void;
};

/** A session's stored rows by run id, in sequence order, and the parsed copy `scan` shares. */
type Loaded = { nextSequence: number; texts: Map<string, string>; shared?: SessionQueue };

/**
 * Each session's turns, one `turns` row apiece, their only writer, and the caches
 * that writer keeps in step: the loaded rows, the index of sessions a worker could
 * care about, and the memo of turn states already folded into `turn_summaries`.
 */
export class SessionQueues {
  private readonly cache = new Map<string, Loaded>();
  private liveIndex: Set<string> | undefined;
  private readonly foldedTurnStates = new Map<string, Map<string, Turn["state"]>>();
  private changeAnnounced = false;

  constructor(
    private readonly kernel: Kernel,
    private readonly deps: QueueDeps,
  ) {
    kernel.onRollback(() => {
      this.cache.clear();
      this.liveIndex = undefined;
      this.changeAnnounced = false;
      this.foldedTurnStates.clear();
    });
    kernel.onSessionDeleted((id) => {
      this.cache.delete(id);
      this.liveIndex?.delete(id);
    });
  }

  /** Forgets every loaded queue and fold memo, as a restart would. */
  clear(): void {
    this.cache.clear();
    this.foldedTurnStates.clear();
  }

  /** A queue of the caller's own, safe to edit and hand back to `write`. */
  read(sessionId: string): SessionQueue {
    const loaded = this.load(sessionId);
    if (loaded.texts.size > 0) this.kernel.readAccounting.queueParses += 1;
    return { version: STATE_VERSION, sessionId, nextSequence: loaded.nextSequence, turns: parseTurns([...loaded.texts.values()]) };
  }

  /** The shared parsed copy, for reading only. */
  scan(sessionId: string): SessionQueue {
    const loaded = this.load(sessionId);
    if (!loaded.shared) {
      if (loaded.texts.size > 0) this.kernel.readAccounting.queueParses += 1;
      loaded.shared = { version: STATE_VERSION, sessionId, nextSequence: loaded.nextSequence, turns: parseTurns([...loaded.texts.values()]) };
    }
    return loaded.shared;
  }

  /** Turns a worker could have business with, read from their own rows. */
  live(sessionId: string): Turn[] {
    return this.rows(sessionId, (store) => liveTurnRows(store, sessionId));
  }

  /** The named turns, in sequence order; unknown ids are skipped. */
  turns(sessionId: string, runIds: readonly string[]): Turn[] {
    return this.rows(sessionId, (store) => turnRowsFor(store, sessionId, runIds));
  }

  /** What `assignmentsOf` needs: handed-over tasks and the runs steered ones joined. */
  assigned(sessionId: string): Turn[] {
    const own = this.rows(sessionId, (store) => assignedTurnRows(store, sessionId));
    const held = new Set(own.map((turn) => turn.runId));
    const joined = own.flatMap((turn) => turn.state === "steered" && turn.steer?.intoRunId && !held.has(turn.steer.intoRunId) ? [turn.steer.intoRunId] : []);
    return joined.length === 0 ? own : [...own, ...this.turns(sessionId, joined)];
  }

  /** What the activity fold needs: live turns, the last ended and last answered, and `runIds`. */
  forActivity(sessionId: string, runIds: readonly string[]): Turn[] {
    return this.rows(sessionId, (store) => [...new Set([...activityTurnRows(store, sessionId), ...turnRowsFor(store, sessionId, runIds)])]);
  }

  /** The newest `limit` settled turns below `before`, plus on the first page every active one. */
  window(sessionId: string, limit: number, before?: string): { turns: Turn[]; page: { before: string | null; more: boolean; total: number } } {
    this.ensureRows(sessionId);
    const read = turnWindowRows(this.kernel.executionStore, sessionId, limit, before);
    if (!read) throw new EngineStateError("not_found", "page cursor names no turn in this session");
    this.kernel.readAccounting.turnRows += read.rows.length;
    return { turns: parseTurns(read.rows), page: { before: read.oldest ?? null, more: read.more, total: read.total } };
  }

  liveSessionIds(): Set<string> {
    if (this.liveIndex) return this.liveIndex;
    const store = this.kernel.executionStore;
    const stored = store.liveQueueIds();
    const persisted = new Set(stored);
    const candidates = stored === undefined ? this.deps.sessionIds() : new Set([...persisted, ...store.unfinishedSessionIds()]);
    const index = new Set<string>();
    for (const sessionId of candidates) {
      const live = this.live(sessionId).length > 0;
      if (live) index.add(sessionId);
      if (live !== persisted.has(sessionId)) store.markLiveQueue(sessionId, live);
    }
    if (stored === undefined) store.markLiveQueuesIndexed();
    this.liveIndex = index;
    for (const sessionId of this.cache.keys()) {
      if (!index.has(sessionId)) this.cache.delete(sessionId);
    }
    return index;
  }

  /** The only writer: validates and stores the turns that changed, and keeps every cache and projection level. */
  write(sessionId: string, queue: SessionQueue): void {
    const loaded = this.load(sessionId);
    const texts = new Map<string, string>();
    const changed: Turn[] = [];
    const rows: TurnRow[] = [];
    for (const turn of queue.turns) {
      if (texts.has(turn.runId)) throw new EngineStateError("invalid_request", "duplicate Telar turn id");
      const text = JSON.stringify(turn);
      texts.set(turn.runId, text);
      if (loaded.texts.get(turn.runId) === text) continue;
      changed.push(turn);
      rows.push(turnRow(turn, text));
    }
    if (!Turn.array().safeParse(changed).success || !Number.isSafeInteger(queue.nextSequence)) {
      throw new EngineStateError("invalid_request", "invalid session queue");
    }
    const removed = [...loaded.texts.keys()].filter((runId) => !texts.has(runId));
    this.kernel.writeRows(
      sessionQueueFile(this.kernel.paths, sessionId),
      () => this.kernel.executionStore.writeTurnRows(sessionId, queue.nextSequence, rows, removed),
      queue,
    );
    this.remember(sessionId, loaded, { nextSequence: queue.nextSequence, texts }, rows);
    this.reconcileTurnSummaries(sessionId, queue);
    this.announceChange();
    this.deps.afterWrite(sessionId, queue.turns);
    const live = queue.turns.some(turnConcernsAWorker);
    this.kernel.executionStore.markLiveQueue(sessionId, live);
    if (!this.liveIndex) return;
    if (live) this.liveIndex.add(sessionId);
    else this.liveIndex.delete(sessionId);
  }

  // The shared copy keeps every unchanged turn object, so a write costs a scan one parse per changed row.
  private remember(sessionId: string, before: Loaded, after: Loaded, rows: readonly TurnRow[]): void {
    if (before.shared) {
      const kept = new Map(before.shared.turns.map((turn) => [turn.runId, turn]));
      for (const row of rows) kept.delete(row.runId);
      const turns = [...after.texts].map(([runId, text]) => kept.get(runId) ?? (JSON.parse(text) as Turn));
      after.shared = { version: STATE_VERSION, sessionId, nextSequence: after.nextSequence, turns };
    }
    this.cache.delete(sessionId);
    this.cache.set(sessionId, after);
    this.evictIdleQueues();
  }

  private load(sessionId: string): Loaded {
    const cached = this.cache.get(sessionId);
    if (cached) {
      this.cache.delete(sessionId);
      this.cache.set(sessionId, cached);
      return cached;
    }
    const nextSequence = this.ensureRows(sessionId);
    const texts = new Map<string, string>();
    let bytes = 0;
    for (const row of allTurnRows(this.kernel.executionStore, sessionId)) {
      texts.set(row.runId, row.value);
      bytes += row.value.length;
    }
    if (texts.size > 0) this.kernel.readAccounting.documentReads += 1;
    this.kernel.readAccounting.documentBytes += bytes;
    this.kernel.readAccounting.turnRows += texts.size;
    const loaded: Loaded = { nextSequence, texts };
    this.cache.set(sessionId, loaded);
    this.evictIdleQueues();
    return loaded;
  }

  private rows(sessionId: string, read: (store: ExecutionStore) => string[]): Turn[] {
    this.ensureRows(sessionId);
    const rows = read(this.kernel.executionStore);
    this.kernel.readAccounting.turnRows += rows.length;
    return parseTurns(rows);
  }

  /** The queue's next sequence, moving a `queue.json` into rows on its first read. */
  private ensureRows(sessionId: string): number {
    const store = this.kernel.executionStore;
    const known = store.queueNextSequence(sessionId);
    if (known !== undefined) return known;
    const file = sessionQueueFile(this.kernel.paths, sessionId);
    const stored = this.kernel.readDocument(file);
    if (stored === undefined) return 1;
    this.kernel.accountWholeRead(file);
    const queue = parseQueue(stored, sessionId);
    const rows = queue.turns.map((turn) => turnRow(turn, JSON.stringify(turn)));
    store.migrateQueueToRows(sessionId, queue.nextSequence, rows, [file, sessionQueueIndexFile(this.kernel.paths, sessionId)]);
    return queue.nextSequence;
  }

  private evictIdleQueues(): void {
    let idle = 0;
    for (const sessionId of [...this.cache.keys()].reverse()) {
      if (this.liveIndex?.has(sessionId) || ++idle <= SCANNED_IDLE_QUEUES_LIMIT) continue;
      this.cache.delete(sessionId);
    }
  }

  private knownTurnStates(sessionId: string): Map<string, Turn["state"]> {
    const cached = this.foldedTurnStates.get(sessionId);
    if (cached) return cached;
    const known = new Map<string, Turn["state"]>(
      this.kernel.executionStore.turnSummaryStates(sessionId).map((row) => [row.runId, row.state as Turn["state"]]),
    );
    if (this.foldedTurnStates.size >= FOLDED_TURNS_LIMIT) {
      const oldest = this.foldedTurnStates.keys().next();
      if (!oldest.done) this.foldedTurnStates.delete(oldest.value);
    }
    this.foldedTurnStates.set(sessionId, known);
    return known;
  }

  // Refolds only the turns whose state moved, and drops rows whose turn left the queue.
  private reconcileTurnSummaries(sessionId: string, queue: SessionQueue): void {
    const store = this.kernel.executionStore;
    const known = this.knownTurnStates(sessionId);
    const stale = queue.turns.filter((turn) => known.get(turn.runId) !== turn.state);
    const live = new Set(queue.turns.map((turn) => turn.runId));
    const gone = [...known.keys()].filter((runId) => !live.has(runId));
    if (stale.length === 0 && gone.length === 0) return;
    const items = stale.length > 0 ? this.deps.itemsForRuns(sessionId, new Set(stale.map((turn) => turn.runId))) : [];
    for (const turn of stale) {
      store.writeTurnSummary(summariseTurn(turn, items));
      known.set(turn.runId, turn.state);
    }
    for (const runId of gone) {
      store.deleteTurnSummary(sessionId, runId);
      known.delete(runId);
    }
  }

  // Once per committed command: a rolled-back write must not wake a worker.
  private announceChange(): void {
    const onChanged = this.deps.onChanged;
    if (!onChanged) return;
    if (!this.kernel.inCommand) {
      onChanged();
      return;
    }
    if (this.changeAnnounced) return;
    this.changeAnnounced = true;
    this.kernel.afterCommit(() => {
      this.changeAnnounced = false;
      this.deps.onChanged?.();
    });
  }
}
