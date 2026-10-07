import crypto from "node:crypto";
import { Subscription as SubscriptionSchema, type Session, type Subscription, type WakeKind } from "@telar/engine-client";
import { assertId, EngineStateError, STATE_VERSION, type Kernel } from "../../platform/kernel";

// The file is rewritten whole on each change, so a loop that subscribed forever would slow every transition.
const MAX_SUBSCRIPTIONS_PER_SESSION = 64;
/** The longest an ongoing (`once: false`) subscription lives. */
const MAX_WATCH_MS = 7 * 24 * 60 * 60_000;
const ALL_WAKE_KINDS: readonly WakeKind[] = ["turn_completed", "turn_failed", "turn_stopped", "request_opened"];

/** The events that end a turn, and so the only ones that may consume a one-shot subscription. */
export const TERMINAL_WAKE_KINDS: readonly WakeKind[] = ["turn_completed", "turn_failed", "turn_stopped"];

/** What subscriptions still ask of the store around them. */
type SubscriptionHost = {
  require(sessionId: string): Session;
  find(sessionId: string): Session | undefined;
  discardQueuedWakes(subscriberId: string, targetSessionId: string): void;
};

/** One session asking to be woken by another. */
export class SessionSubscriptions {
  /** The activity fold's grouped view, kept until the next write; this module is its only writer. */
  private subscriptionsBySubscriber: Map<string, Subscription[]> | undefined;

  constructor(
    private readonly kernel: Kernel,
    private readonly host: SubscriptionHost,
  ) {}

  /** Both sessions must be live. Idempotent on the pair: a retry merges the events into the one subscription. */
  subscribe(
    subscriberSessionId: string,
    input: { targetSessionId: string; events?: WakeKind[]; once?: boolean; completionWake?: Subscription["completionWake"] },
  ): Subscription {
    return this.kernel.command("subscribe", () => {
      assertId(input.targetSessionId, "target session id");
      if (subscriberSessionId === input.targetSessionId) {
        throw new EngineStateError("invalid_request", "a session cannot subscribe to itself");
      }
      const subscriber = this.host.require(subscriberSessionId);
      if (subscriber.state !== "active") throw new EngineStateError("conflict", "an archived session cannot be woken");
      const target = this.host.require(input.targetSessionId);
      if (target.state !== "active") throw new EngineStateError("conflict", "an archived session will do nothing worth waking for");
      const events = input.events && input.events.length > 0 ? [...new Set(input.events)] : [...ALL_WAKE_KINDS];
      const all = this.readSubscriptions();
      const existing = all.find((each) => each.subscriberSessionId === subscriberSessionId && each.targetSessionId === input.targetSessionId);
      if (existing) {
        existing.events = [...new Set([...existing.events, ...events])];
        if (input.once !== undefined) {
          if (input.once) existing.once = true;
          else delete existing.once;
        }
        // Re-subscribing MERGES, so naming a policy changes it and omitting one
        // leaves whatever was chosen before — the same rule `events` follows.
        if (input.completionWake !== undefined) existing.completionWake = input.completionWake;
        this.writeSubscriptions(all);
        return structuredClone(existing);
      }
      const mine = all.filter((each) => each.subscriberSessionId === subscriberSessionId).length;
      if (mine >= MAX_SUBSCRIPTIONS_PER_SESSION) {
        throw new EngineStateError(
          "conflict",
          `this session is already subscribed to ${mine} sessions, the most it may be. Unsubscribe from ones you are finished with — sessions_subscribe with no arguments lists them, and cancel removes one.`,
        );
      }
      const subscription: Subscription = {
        id: `sub_${crypto.randomUUID().replaceAll("-", "")}`,
        subscriberSessionId,
        targetSessionId: input.targetSessionId,
        events,
        ...(input.once ? { once: true } : {}),
        ...(input.completionWake ? { completionWake: input.completionWake } : {}),
        createdAt: this.kernel.now(),
      };
      all.push(subscription);
      this.writeSubscriptions(all);
      return structuredClone(subscription);
    });
  }


  /** With `subscriberSessionId`, another session's subscription reads as
   *  absent — a session may not remove what it did not ask for. */
  unsubscribe(subscriptionId: string, subscriberSessionId?: string): boolean {
    return this.kernel.command("unsubscribe", () => {
      assertId(subscriptionId, "subscription id");
      const all = this.readSubscriptions();
      const index = all.findIndex(
        (each) => each.id === subscriptionId && (subscriberSessionId === undefined || each.subscriberSessionId === subscriberSessionId),
      );
      if (index < 0) return false;
      const [removed] = all.splice(index, 1);
      this.writeSubscriptions(all);
      // "Stop waking me" includes the wakes already waiting: an unsubscribe that
      // left fourteen queued wakes to run one by one stopped nothing a person
      // could see. Only QUEUED ones go; a running wake is the worker's.
      this.host.discardQueuedWakes(removed!.subscriberSessionId, removed!.targetSessionId);
      return true;
    });
  }

  /** What this session has asked to be woken by. */
  subscriptionsFor(subscriberSessionId: string): Subscription[] {
    this.host.require(subscriberSessionId);
    return structuredClone(this.readSubscriptions().filter((each) => each.subscriberSessionId === subscriberSessionId));
  }

  readSubscriptions(): Subscription[] {
    const stored = this.kernel.readDocument(this.kernel.paths.subscriptions) as { subscriptions?: unknown } | undefined;
    const parsed = SubscriptionSchema.array().safeParse(stored?.subscriptions ?? []);
    // A corrupt file costs the subscriptions, not the engine — same rule as
    // the attachments index.
    return parsed.success ? parsed.data : [];
  }

  writeSubscriptions(subscriptions: Subscription[]): void {
    this.subscriptionsBySubscriber = undefined;
    this.kernel.writeDocument(this.kernel.paths.subscriptions, { version: STATE_VERSION, subscriptions });
  }

  subscriptionsOf(subscriberSessionId: string): readonly Subscription[] {
    if (!this.subscriptionsBySubscriber) {
      const grouped = new Map<string, Subscription[]>();
      for (const each of this.readSubscriptions()) grouped.set(each.subscriberSessionId, [...(grouped.get(each.subscriberSessionId) ?? []), each]);
      this.subscriptionsBySubscriber = grouped;
    }
    return this.subscriptionsBySubscriber.get(subscriberSessionId) ?? [];
  }

  /** A session that is gone can neither wake nor be woken: both directions go. */
  dropSubscriptionsOf(sessionId: string): void {
    const all = this.readSubscriptions();
    const kept = all.filter((each) => each.subscriberSessionId !== sessionId && each.targetSessionId !== sessionId);
    if (kept.length !== all.length) this.writeSubscriptions(kept);
  }

  /** The subscriptions `fromSessionId` held on the member move to `toSessionId`, or go. */
  handOver(memberSessionId: string, fromSessionId: string, toSessionId: string | undefined): void {
    const all = this.readSubscriptions();
    const moved = all.filter((each) => each.subscriberSessionId === fromSessionId && each.targetSessionId === memberSessionId);
    if (moved.length > 0) this.writeSubscriptions(all.filter((each) => !moved.includes(each)));
    this.host.discardQueuedWakes(fromSessionId, memberSessionId);
    if (toSessionId === undefined) return;
    for (const each of moved) {
      this.subscribe(toSessionId, { targetSessionId: memberSessionId, events: each.events, ...(each.once ? { once: true } : {}), ...(each.completionWake ? { completionWake: each.completionWake } : {}) });
    }
  }

  /** Removes what will never fire: a target settled, archived or deleted, or an ongoing watch past `MAX_WATCH_MS`. */
  sweepSubscriptions(): string[] {
    const all = this.readSubscriptions();
    const now = this.kernel.now();
    const stale = all.filter((each) => {
      if (!each.once && now - each.createdAt >= MAX_WATCH_MS) return true;
      const target = this.host.find(each.targetSessionId);
      return !target || target.state !== "active" || target.settledOverride === "settled";
    });
    if (stale.length === 0) return [];
    this.writeSubscriptions(all.filter((each) => !stale.includes(each)));
    for (const each of stale) this.host.discardQueuedWakes(each.subscriberSessionId, each.targetSessionId);
    return stale.map((each) => each.id);
  }
}
