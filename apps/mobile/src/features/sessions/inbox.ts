import type { LiveSessionsAnswer } from "@telar/engine-client";
import { systemClock, type Clock, type HostConnection } from "../../platform/connection";

export const BUSY_POLL_MS = 3_000;
export const IDLE_POLL_MS = 10_000;

/** `shelf` holds the settled sessions the lean list leaves out, read only once the Settled shelf has been opened. */
export type InboxSnapshot = { answer?: LiveSessionsAnswer; shelf?: LiveSessionsAnswer; failed?: string };

const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === "AbortError";

const busy = (answer: LiveSessionsAnswer | undefined): boolean =>
  answer?.sessions.some((session) => session.activity === "blocked" || session.activity === "working" || session.activity === "queued") ?? false;

/** One host's session list, polled while the host is online and the app is in front; the ETag keeps an unchanged list to a 304. */
export class Inbox {
  private current: InboxSnapshot = {};
  private etag: string | undefined;
  private shelfEtag: string | undefined;
  private wantsShelf = false;
  private foreground = true;
  private cancelNext: () => void = () => {};
  private inFlight: AbortController | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly connection: HostConnection,
    private readonly clock: Clock = systemClock,
  ) {}

  get snapshot(): InboxSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.unsubscribe ??= this.connection.subscribe(() => this.reschedule());
    this.reschedule();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.halt();
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground;
    this.reschedule();
  }

  refresh(): Promise<void> {
    return this.poll();
  }

  showSettled(): Promise<void> {
    if (this.wantsShelf) return Promise.resolve();
    this.wantsShelf = true;
    return this.poll();
  }

  private reschedule(): void {
    if (this.connection.state.kind === "online" && this.foreground) {
      if (!this.inFlight) void this.poll();
    } else {
      this.halt();
    }
  }

  private halt(): void {
    this.cancelNext();
    this.cancelNext = () => {};
    this.inFlight?.abort(Object.assign(new Error("paused"), { name: "AbortError" }));
    this.inFlight = undefined;
  }

  private async poll(): Promise<void> {
    this.halt();
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const read = await this.connection.call(
        true,
        (signal) => this.connection.client.liveSessionsMatching({ ...(this.etag ? { etag: this.etag } : {}), signal }),
        controller.signal,
      );
      const shelf = this.wantsShelf ? await this.readShelf(controller.signal) : undefined;
      if (!read.notModified || shelf) {
        if (!read.notModified) this.etag = read.etag;
        const answer = read.notModified ? this.current.answer : read;
        const kept = shelf ?? this.current.shelf;
        this.set({ ...(answer ? { answer } : {}), ...(kept ? { shelf: kept } : {}) });
      } else if (this.current.failed) {
        this.set({ ...this.current, failed: undefined });
      }
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return;
      this.set({ ...this.current, failed: error instanceof Error ? error.message : String(error) });
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
    }
    if (controller.signal.aborted || this.connection.state.kind !== "online" || !this.foreground) return;
    this.cancelNext = this.clock.after(busy(this.current.answer) ? BUSY_POLL_MS : IDLE_POLL_MS, () => void this.poll());
  }

  private async readShelf(signal: AbortSignal): Promise<LiveSessionsAnswer | undefined> {
    const read = await this.connection.call(true, (linked) => this.connection.client.liveSessionsMatching({ shelf: true, ...(this.shelfEtag ? { etag: this.shelfEtag } : {}), signal: linked }), signal);
    if (read.notModified) return undefined;
    this.shelfEtag = read.etag;
    return read;
  }

  private set(next: InboxSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}
