import { HostConnection, type HostRecord, type Wakeup } from "./host-connection";

type Deps = ConstructorParameters<typeof HostConnection>[1];

/** One connection per paired Mac, keyed by its lasting host id; adding or removing one never touches the others. */
export class HostRegistry {
  private readonly connections = new Map<string, HostConnection>();
  private readonly listeners = new Set<() => void>();
  private snapshot: HostConnection[] = [];

  constructor(private readonly deps: Deps = {}) {}

  add(record: HostRecord): HostConnection {
    const existing = this.connections.get(record.hostId);
    if (existing) {
      existing.update(record);
      return existing;
    }
    const connection = new HostConnection(record, this.deps);
    this.connections.set(record.hostId, connection);
    connection.start();
    this.changed();
    return connection;
  }

  remove(hostId: string): void {
    this.connections.get(hostId)?.stop();
    if (this.connections.delete(hostId)) this.changed();
  }

  get(hostId: string): HostConnection | undefined {
    return this.connections.get(hostId);
  }

  list(): HostConnection[] {
    return this.snapshot;
  }

  wakeAll(kind: Wakeup): void {
    for (const connection of this.connections.values()) connection.wake(kind);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.snapshot = [...this.connections.values()];
    for (const listener of this.listeners) listener();
  }
}
