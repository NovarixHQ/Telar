import { EngineClient, EngineClientError, type FetchLike } from "@telar/engine-client";
import { probe, rankAddresses } from "./addresses";
import { backoffDelay, RESET_AFTER_ONLINE_MS } from "./backoff";
import { anyOf, systemClock, type Clock } from "./clock";

export type HostRecord = { hostId: string; name: string; token: string; paired: string[] };

export type BlockReason = "unauthorized" | "misdirected";

export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "online"; address: string; since: number }
  | { kind: "backoff"; attempt: number; retryAt: number }
  | { kind: "blocked"; reason: BlockReason }
  | { kind: "stopped" };

export type Wakeup = "reconnect" | "probe";

type Deps = { fetch?: typeof globalThis.fetch; clock?: Clock; random?: () => number };

const IDEMPOTENT = new Set(["GET", "HEAD"]);

const isAbort = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === "AbortError";

/** The one owner of a host's link: it picks the address, retries with backoff, and is the only thing that aborts its own requests. */
export class HostConnection {
  readonly client: EngineClient;
  private current: ConnectionState = { kind: "stopped" };
  private advertised: string[] = [];
  private attempt = 0;
  private generation = new AbortController();
  private cancelRetry: () => void = () => {};
  private readonly listeners = new Set<() => void>();
  private readonly fetch: typeof globalThis.fetch;
  private readonly clock: Clock;
  private readonly random: () => number;

  constructor(
    private record: HostRecord,
    deps: Deps = {},
  ) {
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.clock = deps.clock ?? systemClock;
    this.random = deps.random ?? Math.random;
    // The phone reaches the engine through the cockpit, which serves each `/v2/` route under `/api/`.
    const viaCockpit: FetchLike = (input, init) => this.fetch(String(input).replace(/^(https?:\/\/[^/]+)\/v2\//, "$1/api/"), init);
    const endpoint = Object.defineProperty({ baseUrl: () => this.address() }, "token", { get: () => this.record.token, enumerable: true }) as { baseUrl: () => string; token: string };
    this.client = new EngineClient(endpoint, viaCockpit);
  }

  get hostId(): string {
    return this.record.hostId;
  }

  get name(): string {
    return this.record.name;
  }

  get state(): ConnectionState {
    return this.current;
  }

  addresses(): string[] {
    return rankAddresses(this.record.paired, this.advertised);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.current.kind === "stopped") void this.connect();
  }

  stop(): void {
    this.renew();
    this.set({ kind: "stopped" });
  }

  /** New credentials or addresses from a re-pairing: drop the old link and connect afresh. */
  update(record: HostRecord): void {
    this.record = record;
    this.attempt = 0;
    void this.connect();
  }

  wake(kind: Wakeup): void {
    if (this.current.kind === "stopped" || this.current.kind === "blocked") return;
    if (kind === "probe" && this.current.kind === "connecting") return;
    this.attempt = 0;
    void this.connect();
  }

  async request<T>(method: string, pathname: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    try {
      return await this.client.request<T>(method, pathname, body, anyOf(signal, this.generation.signal));
    } catch (error) {
      if (isAbort(error)) throw error;
      if (!(error instanceof EngineClientError)) throw error;
      if (error.status === 401) this.block("unauthorized");
      else if (error.status === 421) this.block("misdirected");
      else if (error.status === undefined && this.current.kind === "online") {
        await this.connect();
        if (IDEMPOTENT.has(method.toUpperCase()) && this.state.kind === "online" && !signal?.aborted) {
          return this.client.request<T>(method, pathname, body, anyOf(signal, this.generation.signal));
        }
      }
      throw error;
    }
  }

  private address(): string {
    return this.current.kind === "online" ? this.current.address : (this.addresses()[0] ?? "http://invalid");
  }

  private async connect(): Promise<void> {
    const wasOnline = this.current.kind === "online" ? this.current : undefined;
    if (wasOnline && this.clock.now() - wasOnline.since >= RESET_AFTER_ONLINE_MS) this.attempt = 0;
    const { signal } = this.renew();
    this.set({ kind: "connecting" });
    const found = await probe(this.addresses(), this.record.hostId, this.fetch, this.clock, signal);
    if (signal.aborted) return;
    if (found) {
      this.advertised = found.identity.addresses;
      this.set({ kind: "online", address: found.address.replace(/\/+$/, ""), since: this.clock.now() });
      return;
    }
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt += 1;
    this.set({ kind: "backoff", attempt: this.attempt, retryAt: this.clock.now() + delay });
    this.cancelRetry = this.clock.after(delay, () => void this.connect());
  }

  private block(reason: BlockReason): void {
    this.renew();
    this.set({ kind: "blocked", reason });
  }

  private renew(): AbortController {
    this.cancelRetry();
    this.cancelRetry = () => {};
    this.generation.abort(Object.assign(new Error("superseded"), { name: "AbortError" }));
    this.generation = new AbortController();
    return this.generation;
  }

  private set(next: ConnectionState): void {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}
