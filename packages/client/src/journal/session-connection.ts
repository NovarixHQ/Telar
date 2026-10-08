import type { EngineEvent, SessionSnapshot, SnapshotWindow, Task } from "@telar/engine-client";
import { appendJournalEvents } from "./journal";
import { hydrateSession, mergeRows, needsSessionSnapshot, tailSession, type HydratedSession, type SessionSyncApi } from "./session-sync";

type Update = { events: EngineEvent[]; cursor: number; snapshot?: SessionSnapshot };

/** Owns a host/session's cursor and head; mounts borrow it, and failures keep the last committed view. */
export class SessionConnection {
  private current?: HydratedSession;
  private flight?: Promise<HydratedSession>;
  bytes = 0;
  /** When the head was last confirmed by the engine, or saved if it came from disk. */
  readAt = 0;
  constructor(private readonly api: SessionSyncApi, private readonly id: string, private readonly window?: SnapshotWindow) {}
  /** A poll: tails every page above the cursor in hand. */
  read(): Promise<HydratedSession> {
    return this.fly(() => this.refresh());
  }
  /** An opening: a held head catches up by one bounded delta, else a fresh bootstrap. */
  open(): Promise<HydratedSession> {
    return this.fly(() => this.reconcile());
  }
  peek(): HydratedSession | undefined { return this.current; }
  /** Installs a head read from disk unless a live one got here first. */
  seed(head: HydratedSession, savedAt: number): boolean {
    if (this.current) return false;
    this.commit(head, savedAt);
    return true;
  }
  private fly(work: () => Promise<HydratedSession>): Promise<HydratedSession> {
    if (this.flight) return this.flight;
    this.flight = work().finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private commit(next: HydratedSession, at = Date.now()): HydratedSession {
    this.readAt = at;
    if (next !== this.current) {
      this.current = next;
      this.bytes = headBytes(next);
      trimConnections();
    }
    return next;
  }
  private hydrate(): Promise<HydratedSession> {
    return hydrateSession(this.api, this.id, this.window).then((next) => this.commit(next));
  }
  private async refresh(): Promise<HydratedSession> {
    const previous = this.current;
    if (!previous) return this.hydrate();
    return this.commit(apply(previous, await tailSession(this.api, this.id, previous.cursor, this.window), "merge"));
  }
  private async reconcile(): Promise<HydratedSession> {
    const previous = this.current;
    if (!previous || !this.api.sessionDelta) return this.hydrate();
    // An engine without `/delta` answers 404; a real outage fails the bootstrap too.
    const delta = await this.api.sessionDelta(this.id, previous.cursor).catch(() => ({ reset: true as const }));
    if (delta.reset) return this.hydrate();
    if (!delta.events.length) return this.commit(previous);
    const snapshot = needsSessionSnapshot(delta.events) ? await this.api.session(this.id, this.window) : undefined;
    return this.commit(apply(previous, { events: delta.events, cursor: delta.cursor, ...(snapshot ? { snapshot } : {}) }, "replace"));
  }
}

/** `merge` keeps turns a live view already showed; `replace` makes an opening equal a fresh bootstrap. */
function apply(previous: HydratedSession, update: Update, rows: "merge" | "replace"): HydratedSession {
  const { snapshot } = update;
  const baseCursor = snapshot?.cursor;
  // Nothing arrived: reuse the previous array so downstream state and the fold don't churn.
  const events =
    update.events.length === 0 && baseCursor === undefined
      ? previous.events
      : appendJournalEvents(previous.events, update.events).filter((event) => baseCursor === undefined || event.id > baseCursor);
  const patched = [...events].reverse().find((event) => event.type === "session.updated");
  const merge = rows === "merge" && snapshot;
  return {
    ...previous,
    ...(snapshot ? { ...snapshot, page: rows === "merge" ? previous.page : snapshot.page } : {}),
    ...(merge ? { turns: mergeRows(previous.turns, merge.turns, (row) => row.runId), items: mergeRows(previous.items, merge.items, (row) => row.id) } : {}),
    tasks: withTaskEvents(merge ? mergeRows(previous.tasks, merge.tasks, (row) => row.id) : (snapshot?.tasks ?? previous.tasks), update.events),
    ...(patched?.type === "session.updated" ? { session: patched.session } : {}),
    events, cursor: Math.max(previous.cursor, update.cursor, baseCursor ?? 0),
  };
}

// A windowed snapshot omits tasks whose turn scrolled out, so their ending reaches the cockpit only as an event.
function withTaskEvents(tasks: Task[], events: readonly EngineEvent[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const event of events) {
    if (event.type !== "task.started" && event.type !== "task.progress" && event.type !== "task.completed") continue;
    const held = byId.get(event.task.id);
    if (!held || event.task.updatedAt > held.updatedAt) byId.set(event.task.id, event.task);
  }
  return byId.size === tasks.length && tasks.every((task) => byId.get(task.id) === task) ? tasks : [...byId.values()];
}

export const HEADS_IN_MEMORY = 16;
export const HEAD_MEMORY_BYTES = 20_000_000;

export function headBytes(head: unknown): number {
  return JSON.stringify(head).length;
}

const connections = new Map<string, SessionConnection>();

/** Least recently used first; the newest is never evicted, so the open session keeps its head. */
function trimConnections(): void {
  let total = 0;
  for (const connection of connections.values()) total += connection.bytes;
  const newest = [...connections.keys()].at(-1);
  for (const [key, connection] of connections) {
    if (key === newest || (connections.size <= HEADS_IN_MEMORY && total <= HEAD_MEMORY_BYTES)) break;
    connections.delete(key);
    total -= connection.bytes;
  }
}

export function sessionConnection(host: string, api: SessionSyncApi, id: string, window?: SnapshotWindow): SessionConnection {
  const key = JSON.stringify([host, id, window ?? null]);
  let connection = connections.get(key);
  if (!connection) connection = new SessionConnection(api, id, window);
  connections.delete(key); connections.set(key, connection);
  trimConnections();
  return connection;
}

/** Tests: which connections are held, least recently used first. */
export function heldConnections(): string[] {
  return [...connections.keys()];
}

export function clearConnections(): void {
  connections.clear();
}
