import type { ItemDetail, NotificationDetail, TurnAttachment, WakeReason } from "@telar/engine-client";

export type SteerMessage = {
  text: string;
  notice?: string;
  attachments?: TurnAttachment[];
  sender?: { sessionId?: string };
  wakeReason?: WakeReason;
  notification?: NotificationDetail;
};

/** The transcript row for a steered message; the notice sits beside the body so the row can collapse to what the model saw. */
export function steerRowDetail(message: SteerMessage): ItemDetail {
  if (message.notification) return { type: "notification", notification: message.notification };
  const attachments = message.attachments ?? [];
  return {
    type: "user_message",
    text: message.text,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(message.sender ? { sender: message.sender } : {}),
    ...(message.notice ? { notice: message.notice } : {}),
    ...(message.wakeReason ? { wakeReason: message.wakeReason } : {}),
  };
}

export class SteerMailbox {
  private queue: SteerMessage[] = [];
  private closed = false;
  private wakers: Array<() => void> = [];
  private drainListeners: Array<() => void> = [];

  push(message: string | SteerMessage): boolean {
    if (this.closed) return false;
    this.queue.push(typeof message === "string" ? { text: message } : message);
    this.wakeAll();
    return true;
  }

  drain(): SteerMessage[] {
    const queued = this.queue;
    this.queue = [];
    if (queued.length > 0) for (const listener of this.drainListeners) listener();
    return queued;
  }

  onDrain(listener: () => void): void {
    this.drainListeners.push(listener);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  wake(): Promise<void> {
    if (this.queue.length > 0 || this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => this.wakers.push(resolve));
  }

  close(): void {
    this.closed = true;
    this.wakeAll();
  }

  private wakeAll(): void {
    const waiting = this.wakers;
    this.wakers = [];
    for (const wake of waiting) wake();
  }
}
