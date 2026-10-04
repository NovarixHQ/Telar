import fs from "node:fs";
import type { EngineEvent } from "@telar/engine-client";
import type { ExecutionStore } from "../db/execution-store";
import type { EngineStatePaths } from "../fs/state-paths";
import { parseSpan, type DocumentIndex } from "../db/document-window";
import { atomicWrite } from "../fs/atomic";
import { EngineStateError } from "./errors";

export const STATE_VERSION = 2 as const;

export function assertStateVersion(value: unknown, document: string): void {
  const version = (value as { version?: unknown } | null)?.version;
  if (version === STATE_VERSION) return;
  if (version === 1) {
    throw new EngineStateError(
      "invalid_request",
      `this ${document} was written by protocol v1, which this engine no longer reads. ` +
        `v2 is a deliberate hard break with no migration — clear the engine state root (TELAR_HOME/engine) and start fresh.`,
    );
  }
  throw new EngineStateError("invalid_request", `invalid ${document}`);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A journal record before the engine stamps its envelope. */
export type JournalEntry = DistributiveOmit<EngineEvent, "id" | "at" | "sessionId" | "runId">;

/** Wraps every document write; `written` is what an indexed write carries along for its reader. */
type WriteRoute = (file: string, write: () => void, written?: unknown) => void;

type KernelOptions<Notifier> = {
  paths: EngineStatePaths;
  now: () => number;
  executionStore: ExecutionStore;
  notifier?: Notifier;
};

export class Kernel<Notifier = unknown> {
  readonly paths: EngineStatePaths;
  readonly now: () => number;
  readonly executionStore: ExecutionStore;
  readonly notifier?: Notifier;
  /** What reads touched, so tests can hold whole-document parses to a ratchet. */
  readonly readAccounting = { documentBytes: 0, documentReads: 0, queueParses: 0, itemParses: 0, turnRows: 0 };
  /** The newest record naming each session's running turn; `Turn.lastProgressAt` is its durable copy. */
  readonly runProgress = new Map<string, { runId: string; at: number }>();

  private depth = 0;
  private pendingAfterCommit: Array<() => void> = [];
  private readonly beforeCommitHooks: Array<() => void> = [];
  private readonly rollbackHooks: Array<() => void> = [];
  private readonly sessionDeletedHooks: Array<(sessionId: string) => void> = [];
  private readonly watchers = new Set<(event: EngineEvent) => void>();
  private route: WriteRoute = (_file, write) => write();

  constructor(options: KernelOptions<Notifier>) {
    this.paths = options.paths;
    this.now = options.now;
    this.executionStore = options.executionStore;
    this.notifier = options.notifier;
  }

  get inCommand(): boolean {
    return this.depth > 0;
  }

  /** Runs at the end of the outermost command, inside its transaction. */
  beforeCommit(hook: () => void): void {
    this.beforeCommitHooks.push(hook);
  }
  /** Queued effects run once, in order, after the outermost command commits; a rollback drops them. */
  afterCommit(effect: () => void): void {
    this.pendingAfterCommit.push(effect);
  }
  onRollback(hook: () => void): void {
    this.rollbackHooks.push(hook);
  }
  onSessionDeleted(hook: (sessionId: string) => void): void {
    this.sessionDeletedHooks.push(hook);
  }
  sessionDeleted(sessionId: string): void {
    for (const hook of this.sessionDeletedHooks) hook(sessionId);
  }
  onWrite(route: WriteRoute): void {
    this.route = route;
  }

  command<T>(name: string, action: () => T, commandId?: string): T {
    this.depth += 1;
    let result: T;
    try {
      result = this.executionStore.transaction(name, () => {
        const value = action();
        if (this.depth === 1) for (const hook of this.beforeCommitHooks) hook();
        return value;
      }, commandId);
    } catch (error) {
      this.pendingAfterCommit = [];
      for (const hook of this.rollbackHooks) hook();
      throw error;
    } finally {
      this.depth -= 1;
    }
    if (this.depth === 0) {
      const effects = this.pendingAfterCommit.splice(0);
      for (const effect of effects) effect();
    }
    return result;
  }

  readDocument(file: string): unknown | undefined {
    return this.executionStore.owns(file) ? this.executionStore.read(file) : readJson(file);
  }

  writeDocument(file: string, value: unknown, mode?: number): void {
    this.route(file, () => {
      if (this.executionStore.owns(file)) this.executionStore.write(file, value);
      else atomicWrite(file, value, mode);
    });
  }

  /** Rows stored under a document's name, so the write route sees them as that document's write. */
  writeRows(file: string, write: () => void, written?: unknown): void {
    this.route(file, write, written);
  }

  /** The index beside `file`, or `undefined` when none still describes it. */
  documentIndex(file: string, indexFile: string): DocumentIndex | undefined {
    const stored = this.readDocument(indexFile) as DocumentIndex | undefined;
    this.readAccounting.documentBytes += this.documentBytes(indexFile) ?? 0;
    if (!stored || stored.version !== STATE_VERSION || !Array.isArray(stored.rows)) return undefined;
    return this.documentBytes(file) === stored.length ? stored : undefined;
  }

  documentBytes(file: string): number | undefined {
    return this.executionStore.byteLength(file);
  }

  /** The rows `wanted` names, parsed from the one span that covers them all. */
  readIndexedRows(file: string, wanted: DocumentIndex["rows"]): unknown[] {
    if (wanted.length === 0) return [];
    const from = Math.min(...wanted.map((row) => row.start));
    const to = Math.max(...wanted.map((row) => row.end));
    const span = this.executionStore.slice(file, from, to);
    if (!span || span.length !== to - from) throw new EngineStateError("invalid_request", "document index does not describe this document");
    this.readAccounting.documentBytes += span.length;
    this.readAccounting.documentReads += 1;
    return parseSpan(span);
  }

  accountWholeRead(file: string): void {
    this.readAccounting.documentBytes += this.documentBytes(file) ?? 0;
    this.readAccounting.documentReads += 1;
  }

  /** The single journal writer. Every record naming a run stamps that run's liveness. */
  appendEvent(sessionId: string, event: JournalEntry, runId?: string): EngineEvent {
    const at = this.now();
    if (runId) this.runProgress.set(sessionId, { runId, at });
    const stored = {
      id: this.executionStore.cursor(sessionId) + 1,
      at,
      sessionId,
      ...(runId ? { runId } : {}),
      ...event,
    } as EngineEvent;
    this.executionStore.append(stored);
    this.publish(stored);
    return stored;
  }

  /** Every session event this process appends, after it is durable. */
  watch(listener: (event: EngineEvent) => void): () => void {
    this.watchers.add(listener);
    return () => {
      this.watchers.delete(listener);
    };
  }

  private publish(event: EngineEvent): void {
    if (this.watchers.size === 0) return;
    for (const watcher of [...this.watchers]) {
      try {
        watcher(event);
      } catch {
        // A gone socket's own route unsubscribes it; it must not fail the turn.
      }
    }
  }
}

function readJson(file: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
