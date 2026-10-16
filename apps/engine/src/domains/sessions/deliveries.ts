import { z } from "zod";
import { Id, NotificationDetail, Timestamp } from "@telar/engine-client";
import { STATE_VERSION, type Kernel } from "../../platform/kernel";

const DeliveryState = z.enum(["pending", "claimed", "delivered", "acknowledged", "disposed"]);

const Delivery = z.object({
  id: Id,
  parentSessionId: Id,
  childSessionId: Id,
  generation: z.number().int().positive(),
  state: DeliveryState,
  notification: NotificationDetail,
  runId: Id.optional(),
  createdAt: Timestamp,
  settledAt: Timestamp.optional(),
});
export type Delivery = z.infer<typeof Delivery>;

const KEEP_SETTLED_MS = 24 * 60 * 60_000;
const isOpen = (delivery: Delivery): boolean => delivery.state === "pending" || delivery.state === "claimed";

export class SessionDeliveries {
  private cache: Delivery[] | undefined;

  constructor(private readonly kernel: Kernel) {
    kernel.onRollback(() => (this.cache = undefined));
  }

  record(input: { parentSessionId: string; childSessionId: string; generation: number; notification: NotificationDetail }): boolean {
    const id = `delivery_${input.parentSessionId}_${input.childSessionId}_${input.generation}`;
    const all = this.read();
    if (all.some((delivery) => delivery.id === id)) return false;
    this.write([...all, { id, ...input, state: "pending", createdAt: this.kernel.now() }]);
    return true;
  }

  forParent(parentSessionId: string): Delivery[] {
    return this.read().filter((delivery) => delivery.parentSessionId === parentSessionId);
  }

  openFor(parentSessionId: string): Delivery[] {
    return this.forParent(parentSessionId).filter(isOpen);
  }

  parentsWithOpen(): string[] {
    return [...new Set(this.read().filter(isOpen).map((delivery) => delivery.parentSessionId))];
  }

  update(ids: ReadonlySet<string>, change: Partial<Pick<Delivery, "state" | "runId">>): void {
    if (ids.size === 0) return;
    const at = this.kernel.now();
    this.write(this.read().map((delivery) => {
      if (!ids.has(delivery.id)) return delivery;
      const { runId: _runId, ...rest } = delivery;
      const next = { ...(change.runId === undefined && change.state === "pending" ? rest : delivery), ...change };
      return isOpen(next) ? next : { ...next, settledAt: at };
    }));
  }

  private read(): Delivery[] {
    if (!this.cache) {
      const stored = this.kernel.readDocument(this.kernel.paths.deliveries) as { deliveries?: unknown } | undefined;
      const parsed = Delivery.array().safeParse(stored?.deliveries ?? []);
      this.cache = parsed.success ? parsed.data : [];
    }
    return this.cache;
  }

  private write(deliveries: Delivery[]): void {
    const now = this.kernel.now();
    const kept = deliveries.filter((delivery) => isOpen(delivery) || now - (delivery.settledAt ?? now) < KEEP_SETTLED_MS);
    this.cache = undefined;
    this.kernel.writeDocument(this.kernel.paths.deliveries, { version: STATE_VERSION, deliveries: kept });
  }
}
