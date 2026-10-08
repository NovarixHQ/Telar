import { INITIAL_TURNS, projectJournal, SessionConnection, tailIntervalMs, type HydratedSession, type JournalTurn, type SessionSyncApi } from "@telar/client/journal";
import { systemClock, type Clock, type HostConnection } from "../../platform/connection";

export type FeedSnapshot = { head?: HydratedSession; turns: JournalTurn[]; failed?: string };

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
  private readonly listeners = new Set<() => void>();
  private cancelNext: () => void = () => {};
  private running = false;
  private opened = false;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly host: HostConnection,
    sessionId: string,
    private readonly clock: Clock = systemClock,
  ) {
    this.session = new SessionConnection(syncApi(host), sessionId, { turns: INITIAL_TURNS });
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

  private async tick(): Promise<void> {
    this.cancelNext();
    if (!this.running || this.host.state.kind !== "online") return;
    try {
      const head = await (this.opened ? this.session.read() : this.session.open());
      this.opened = true;
      if (head !== this.current.head) this.set({ head, turns: projectJournal(head.turns, head.items, head.events, head.tasks) });
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
