import fs from "node:fs";
import path from "node:path";
import type { ExecutionStore } from "./execution-store";

/** One turn as stored: the scalars readers select on, beside the turn's JSON. */
export type TurnRow = {
  runId: string;
  sequence: number;
  state: string;
  acceptedAt: number;
  updatedAt: number;
  completedAt?: number;
  /** A worker could have business with it: what the live-queue index and a claim read. */
  live: boolean;
  /** A task another session handed over: what `assignmentsOf` folds. */
  assigned: boolean;
  value: string;
};

/** Present once a session's turns are rows; its value is the queue's next sequence. */
const QUEUE_ROWS_PREFIX = "queue-rows/";

const ACTIVE = "('queued','claimed','running','steering')";
const RESULT = "('completed','failed','stopped')";

export function queueNextSequence(store: ExecutionStore, sessionId: string): number | undefined {
  const row = store.statement("SELECT value FROM metadata WHERE key=?").get(`${QUEUE_ROWS_PREFIX}${sessionId}`);
  return row ? Number(row.value) : undefined;
}

function upsert(store: ExecutionStore, sessionId: string, row: TurnRow): void {
  store.statement(
    "INSERT INTO turns(session_id,run_id,sequence,state,accepted_at,updated_at,completed_at,live,assigned,value) VALUES(?,?,?,?,?,?,?,?,?,?) "
      + "ON CONFLICT(session_id,run_id) DO UPDATE SET sequence=excluded.sequence, state=excluded.state, accepted_at=excluded.accepted_at, "
      + "updated_at=excluded.updated_at, completed_at=excluded.completed_at, live=excluded.live, assigned=excluded.assigned, value=excluded.value",
  ).run(sessionId, row.runId, row.sequence, row.state, row.acceptedAt, row.updatedAt, row.completedAt ?? null, row.live ? 1 : 0, row.assigned ? 1 : 0, row.value);
}

/** The rows, the deleted documents and the marker commit together, so a kill between them loses no turn. */
export function migrateQueueToRows(store: ExecutionStore, sessionId: string, nextSequence: number, rows: readonly TurnRow[], documents: string[]): void {
  store.atomically(() => {
    for (const row of rows) upsert(store, sessionId, row);
    for (const key of documents) store.statement("DELETE FROM documents WHERE key=?").run(path.relative(store.root, key));
    store.setMetadata(`${QUEUE_ROWS_PREFIX}${sessionId}`, String(nextSequence));
  });
}

export function writeTurnRows(store: ExecutionStore, sessionId: string, nextSequence: number, rows: readonly TurnRow[]): void {
  store.atomically(() => {
    for (const row of rows) upsert(store, sessionId, row);
    store.setMetadata(`${QUEUE_ROWS_PREFIX}${sessionId}`, String(nextSequence));
  });
}

const values = (rows: Array<Record<string, unknown>>): Array<{ runId: string; value: string }> =>
  rows.map((row) => ({ runId: String(row.run_id), value: String(row.value) }));

export function allTurnRows(store: ExecutionStore, sessionId: string): Array<{ runId: string; value: string }> {
  return values(store.statement("SELECT run_id,value FROM turns WHERE session_id=? ORDER BY sequence").all(sessionId));
}

/** What a command edits: every unfinished turn (live, or ambiguous until a person decides) and the named ones. */
export function openTurnRows(store: ExecutionStore, sessionId: string, runIds: readonly string[]): Array<{ runId: string; value: string }> {
  return values(store.statement(
    `SELECT run_id,sequence,value FROM turns WHERE session_id=?1 AND (live=1 OR state='ambiguous')
     UNION SELECT t.run_id,t.sequence,t.value FROM json_each(?2) AS j CROSS JOIN turns AS t ON t.session_id=?1 AND t.run_id=j.value
     ORDER BY 2`,
  ).all(sessionId, JSON.stringify(runIds)));
}

export function liveTurnRows(store: ExecutionStore, sessionId: string): string[] {
  return store.statement("SELECT value FROM turns WHERE session_id=? AND live=1 ORDER BY sequence").all(sessionId).map((row) => String(row.value));
}

// The run ids ride as JSON so the SQL text stays constant; the join leads with them so each is one key lookup.
const TURN_ROWS_FOR_SQL =
  "SELECT DISTINCT t.sequence,t.value FROM json_each(?2) AS j CROSS JOIN turns AS t ON t.session_id=?1 AND t.run_id=j.value ORDER BY t.sequence";

export function turnRowsFor(store: ExecutionStore, sessionId: string, runIds: readonly string[]): string[] {
  if (runIds.length === 0) return [];
  return store.statement(TURN_ROWS_FOR_SQL).all(sessionId, JSON.stringify(runIds)).map((row) => String(row.value));
}

/** Handed-over tasks; a steered one's outcome lives in the run it joined, which `turnRowsFor` adds. */
export function assignedTurnRows(store: ExecutionStore, sessionId: string): string[] {
  return store.statement("SELECT value FROM turns WHERE session_id=? AND assigned=1 ORDER BY sequence").all(sessionId).map((row) => String(row.value));
}

/** Sessions holding a task `coordinatorSessionId` handed over. */
export function delegatesOf(store: ExecutionStore, coordinatorSessionId: string): string[] {
  return store.statement("SELECT DISTINCT session_id FROM turns WHERE assigned=1 AND json_extract(value,'$.sender.sessionId')=?")
    .all(coordinatorSessionId).map((row) => String(row.session_id));
}

/** What the activity fold reads: the live turns, the last to end and the last with a result. */
export function activityTurnRows(store: ExecutionStore, sessionId: string): string[] {
  return store.statement(
    `SELECT sequence,value FROM turns WHERE session_id=?1 AND live=1
     UNION SELECT * FROM (SELECT sequence,value FROM turns WHERE session_id=?1 AND completed_at IS NOT NULL ORDER BY completed_at DESC, sequence DESC LIMIT 1)
     UNION SELECT * FROM (SELECT sequence,value FROM turns WHERE session_id=?1 AND state IN ${RESULT} ORDER BY sequence DESC LIMIT 1)
     ORDER BY 1`,
  ).all(sessionId).map((row) => String(row.value));
}

/**
 * The newest `limit` settled turns below `before`, and on the first page every active one.
 * `undefined` when `before` names no turn of the session.
 */
export function turnWindowRows(store: ExecutionStore, sessionId: string, limit: number, before?: string): { rows: string[]; oldest?: string; more: boolean; total: number } | undefined {
  let end = Number.MAX_SAFE_INTEGER;
  if (before !== undefined) {
    const row = store.statement("SELECT sequence FROM turns WHERE session_id=? AND run_id=?").get(sessionId, before);
    if (!row) return undefined;
    end = Number(row.sequence);
  }
  const settled = store.statement(`SELECT run_id,sequence,value FROM turns WHERE session_id=? AND sequence<? AND state NOT IN ${ACTIVE} ORDER BY sequence DESC LIMIT ?`)
    .all(sessionId, end, limit + 1);
  const more = settled.length > limit;
  const paged = settled.slice(0, limit).reverse();
  const active = before === undefined
    ? store.statement(`SELECT run_id,sequence,value FROM turns WHERE session_id=? AND live=1 AND state IN ${ACTIVE}`).all(sessionId)
    : [];
  const total = Number(store.statement("SELECT COUNT(*) AS count FROM turns WHERE session_id=?").get(sessionId)?.count ?? 0);
  const rows = [...paged, ...active].sort((a, b) => Number(a.sequence) - Number(b.sequence)).map((row) => String(row.value));
  return { rows, ...(more && paged[0] ? { oldest: String(paged[0].run_id) } : {}), more, total };
}

/** Writes the session's rows back as the `queue.json` an import reads; false when its turns are not rows. */
export function exportQueueRows(store: ExecutionStore, sessionId: string, directory: string): boolean {
  const nextSequence = queueNextSequence(store, sessionId);
  if (nextSequence === undefined) return false;
  const turns = allTurnRows(store, sessionId).map((row) => row.value).join(",");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, "queue.json"), `{"version":2,"sessionId":${JSON.stringify(sessionId)},"nextSequence":${nextSequence},"turns":[${turns}]}`, { mode: 0o600 });
  return true;
}

export function deleteTurnRows(store: ExecutionStore, sessionId: string): void {
  store.statement("DELETE FROM turns WHERE session_id=?").run(sessionId);
  store.statement("DELETE FROM metadata WHERE key=?").run(`${QUEUE_ROWS_PREFIX}${sessionId}`);
}
