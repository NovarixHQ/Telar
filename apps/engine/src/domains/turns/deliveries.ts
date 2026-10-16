import crypto from "node:crypto";
import type { NotificationDetail, Turn, WakeReason } from "@telar/engine-client";
import { EngineStateError, type Kernel } from "../../platform/kernel";
import type { Delivery, SessionDeliveries, SessionQueue, SessionRecords } from "../sessions";
import type { TurnSubmission } from "./intake";
import { mergeNotifications, notificationLabel } from "./notification";

// A claim whose turn reached a model, or was steered into one, is delivered; one that never ran goes back out.
const ENDED_STATES: ReadonlySet<Turn["state"]> = new Set(["completed", "failed", "stopped", "ambiguous"]);

type DeliveryDeps = {
  deliveries: SessionDeliveries;
  records: SessionRecords;
  readQueue: (sessionId: string, runIds?: readonly string[]) => SessionQueue;
  submitTurn: (sessionId: string, input: TurnSubmission) => { turn: Turn; replayed: boolean };
  hasLiveTurn: (sessionId: string) => boolean;
  waitingNotificationTurn: (sessionId: string) => string | undefined;
  joinWaitingNotification: (sessionId: string, waitingRunId: string, notification: NotificationDetail) => void;
  discardQueuedWakes: (subscriberId: string, targetSessionId: string, runId: string) => number;
};

function wakeReasonOf(merged: NotificationDetail, parentSessionId: string): WakeReason {
  return {
    kind: merged.wakeKind ?? "turn_completed",
    sessionId: merged.sessionId ?? parentSessionId,
    ...(merged.runId ? { runId: merged.runId } : {}),
  };
}

/** Moves the outbox's builder endings to their parents: batched into one wake per parent turn, each exactly once. */
export class BuilderDeliveries {
  private readonly dirty = new Set<string>();

  constructor(
    private readonly kernel: Kernel,
    private readonly deps: DeliveryDeps,
  ) {
    kernel.onRollback(() => this.dirty.clear());
  }

  touch(parentSessionId: string): void {
    if (this.deps.deliveries.openFor(parentSessionId).length > 0) this.dirty.add(parentSessionId);
  }

  markAll(): void {
    for (const parentSessionId of this.deps.deliveries.parentsWithOpen()) this.dirty.add(parentSessionId);
  }

  /** Reconciles every parent touched in this command; false when there was nothing to do. */
  settle(): boolean {
    if (this.dirty.size === 0) return false;
    const batch = [...this.dirty];
    this.dirty.clear();
    for (const parentSessionId of batch) {
      try {
        this.reconcile(parentSessionId);
      } catch (error) {
        console.warn(`[engine] could not deliver the builder endings of ${parentSessionId}:`, error);
      }
    }
    return true;
  }

  /** A person's message steered into a busy parent takes the pending endings with it. */
  steer(parentSessionId: string): void {
    this.claimInto(parentSessionId, this.pending(parentSessionId), { steer: true });
  }

  /** The parent read the run itself: an ending not yet in front of its model is withdrawn. */
  acknowledge(readerSessionId: string, targetSessionId: string, runId: string): void {
    const read = this.deps.deliveries.forParent(readerSessionId).filter((delivery) => {
      const fetch = delivery.notification.fetch;
      if (delivery.state === "acknowledged" || delivery.state === "disposed" || fetch?.runId !== runId) return false;
      return fetch.sessionId === targetSessionId || delivery.childSessionId === targetSessionId;
    });
    for (const delivery of read) {
      if (delivery.state === "claimed") this.deps.discardQueuedWakes(readerSessionId, delivery.childSessionId, runId);
    }
    this.deps.deliveries.update(new Set(read.map((delivery) => delivery.id)), { state: "acknowledged" });
  }

  pendingNotifications(parentSessionId: string): NotificationDetail[] {
    return this.pending(parentSessionId).map((delivery) => delivery.notification);
  }

  private pending(parentSessionId: string): Delivery[] {
    return this.deps.deliveries.openFor(parentSessionId).filter((delivery) => delivery.state === "pending");
  }

  private reconcile(parentSessionId: string): void {
    const open = this.deps.deliveries.openFor(parentSessionId);
    if (open.length === 0) return;
    const parent = this.findActive(parentSessionId);
    if (!parent) return this.deps.deliveries.update(new Set(open.map((delivery) => delivery.id)), { state: "disposed" });
    const claimed = open.filter((delivery) => delivery.state === "claimed" && delivery.runId);
    const turns = new Map(this.deps.readQueue(parentSessionId, claimed.map((delivery) => delivery.runId!)).turns.map((turn) => [turn.runId, turn]));
    const delivered = new Set<string>();
    const unclaimed = new Set<string>();
    for (const delivery of claimed) {
      const turn = turns.get(delivery.runId!);
      if (!turn || turn.state === "discarded" || (ENDED_STATES.has(turn.state) && turn.startedAt === undefined)) unclaimed.add(delivery.id);
      else if (turn.state !== "queued" && turn.state !== "steering") delivered.add(delivery.id);
    }
    this.deps.deliveries.update(delivered, { state: "delivered" });
    this.deps.deliveries.update(unclaimed, { state: "pending" });
    const pending = this.pending(parentSessionId);
    if (pending.length === 0 || this.deps.hasLiveTurn(parentSessionId)) return;
    this.claimInto(parentSessionId, pending, { steer: false });
  }

  private claimInto(parentSessionId: string, pending: Delivery[], options: { steer: boolean }): void {
    if (pending.length === 0 || !this.findActive(parentSessionId)) return;
    const merged = mergeNotifications(pending.map((delivery) => delivery.notification));
    const waiting = options.steer ? undefined : this.deps.waitingNotificationTurn(parentSessionId);
    let runId = waiting;
    if (waiting) this.deps.joinWaitingNotification(parentSessionId, waiting, merged);
    else {
      const notification: NotificationDetail = { ...merged, deliveries: 1 };
      try {
        runId = this.deps.submitTurn(parentSessionId, {
          runId: `run_${crypto.randomUUID().replaceAll("-", "")}`,
          input: notificationLabel(notification),
          origin: "session",
          wakeReason: wakeReasonOf(merged, parentSessionId),
          notification,
          ...(options.steer ? { steerNow: true } : {}),
        }).turn.runId;
      } catch (error) {
        if (error instanceof EngineStateError && error.code === "conflict") return;
        throw error;
      }
    }
    this.deps.deliveries.update(new Set(pending.map((delivery) => delivery.id)), { state: "claimed", runId: runId! });
  }

  private findActive(sessionId: string) {
    try {
      const session = this.deps.records.require(sessionId);
      return session.state === "active" ? session : undefined;
    } catch {
      return undefined;
    }
  }
}
