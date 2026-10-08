import { INITIAL_TURNS, loadOlderTurns, mergeOlderPage, projectJournal, SessionConnection, tailIntervalMs, type HydratedSession, type JournalTurn, type SessionSyncApi } from "@telar/client/journal";
import type { SnapshotPage } from "@telar/engine-client";
import { systemClock, type Clock, type HostConnection } from "../../platform/connection";

export type FeedSnapshot = { head?: HydratedSession; turns: JournalTurn[]; failed?: string; hasOlder?: boolean; loadingOlder?: boolean };
type OlderRows = Parameters<typeof mergeOlderPage>[1];

const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === "AbortError";

function syncApi(host: HostConnection): SessionSyncApi {
  const read = <T>(run: () => Promise<T>) => host.call(true, run);
  return {
    session: (id, window) => read(() => host.client.session(id, window)),
    events: (id, after) => read(() => host.client.events(id, after)),
    eventsIfChanged: (id, after, etag) => read(() => host.client.eventsIfChanged(id, after, undefined, etag)),
    sessionBootstrap: (id, window) => read(() => host.client.sessionBootstrap(id, window)),
    sessionDelta: (id, after) => read(() => host.client.sessionDelta(id, after)),
  };
}

/** One open session: the cockpit's own SessionConnection, tailed every second while a turn runs and every 3 s otherwise. */
export class SessionFeed {
  private current: FeedSnapshot = { turns: [] };
  private readonly session: SessionConnection;
  private readonly api: SessionSyncApi;
  private older: OlderRows = { turns: [], items: [], tasks: [] };
  private olderPage?: SnapshotPage;
  private readonly listeners = new Set<() => void>();
  private cancelNext: () => void = () => {};
  private running = false;
  private opened = false;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly host: HostConnection,
    private readonly sessionId: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.api = syncApi(host);
    this.session = new SessionConnection(this.api, sessionId, { turns: INITIAL_TURNS });
  }

  get snapshot(): FeedSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.host.subscribe(() => {
      if (this.host.state.kind === "online" && this.running) void this.tick();
    });
    void this.tick();
  }

  stop(): void {
    this.running = false;
    this.unsubscribe?.();
    this.cancelNext();
  }

  /** Reads now, after the phone itself changed the session, instead of waiting for the next tick. */
  refresh(): Promise<void> {
    return this.tick();
  }

  /** Prepends the page of turns above the oldest one shown. */
  async loadOlder(): Promise<void> {
    const page = this.olderPage ?? this.current.head?.page;
    if (this.current.loadingOlder || !page?.more || !page.before) return;
    this.set({ ...this.current, loadingOlder: true });
    try {
      const fetched = await loadOlderTurns(this.api, this.sessionId, page.before);
      this.older = mergeOlderPage(this.older, fetched);
      this.olderPage = fetched.page ?? { before: null, more: false };
      this.show(this.current.head, { loadingOlder: false });
    } catch (error) {
      this.set({ ...this.current, loadingOlder: false, failed: error instanceof Error ? error.message : String(error) });
    }
  }

  private show(head: HydratedSession | undefined, extra: Partial<FeedSnapshot> = {}): void {
    if (!head) return this.set({ ...this.current, ...extra });
    const rows = mergeOlderPage(head, this.older);
    const page = this.olderPage ?? head.page;
    this.set({ ...this.current, ...extra, head, turns: projectJournal(rows.turns, rows.items, head.events, rows.tasks), hasOlder: Boolean(page?.more && page.before), failed: undefined });
  }

  private async tick(): Promise<void> {
    this.cancelNext();
    if (!this.running || this.host.state.kind !== "online") return;
    try {
      const head = await (this.opened ? this.session.read() : this.session.open());
      this.opened = true;
      if (head !== this.current.head) this.show(head);
      else if (this.current.failed) this.set({ ...this.current, failed: undefined });
    } catch (error) {
      if (isAbort(error)) return;
      this.set({ ...this.current, failed: error instanceof Error ? error.message : String(error) });
    }
    if (!this.running) return;
    this.cancelNext = this.clock.after(tailIntervalMs(this.current.head?.turns ?? []), () => void this.tick());
  }

  private set(next: FeedSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}
