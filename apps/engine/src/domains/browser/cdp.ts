type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Listener = (params: Record<string, unknown>, sessionId: string | undefined) => void;

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly closers = new Set<() => void>();
  private open = true;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => this.shutdown("The browser connection closed."));
    socket.addEventListener("error", () => this.shutdown("The browser connection failed."));
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CdpConnection(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not reach the browser's debugging port.")), { once: true });
    });
  }

  get connected(): boolean {
    return this.open;
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (!this.open) return Promise.reject(new Error("The browser connection is closed."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method: string, listener: Listener): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  onClose(listener: () => void): void {
    this.closers.add(listener);
  }

  close(): void {
    this.shutdown("The browser connection closed.");
    this.socket.close();
  }

  private receive(raw: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "The browser refused the command."));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {}, message.sessionId);
  }

  private shutdown(reason: string): void {
    if (!this.open) return;
    this.open = false;
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
    for (const closer of this.closers) closer();
  }
}
