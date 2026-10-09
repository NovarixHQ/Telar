import { z } from "zod";
import { SessionChild, type Item, type NotificationDetail, type Session, type SessionChildState, type Subscription, type Turn, type WakeKind } from "@telar/engine-client";
import { STATE_VERSION, type Kernel } from "../../platform/kernel";
import { childEndingNotification, firstLine } from "../turns";
import { childProgress } from "./child-progress";
import { TERMINAL_WAKE_KINDS } from "./subscriptions";

const StoredChild = SessionChild.omit({ provider: true, model: true, progress: true });
type StoredChild = z.infer<typeof StoredChild>;

const SUMMARY_CHARS = 200;
const KEEP_ENDED_MS = 7 * 24 * 60 * 60_000;
const MAX_PER_PARENT = 100;
const ENDED_TURN_STATES: ReadonlySet<Turn["state"]> = new Set(["completed", "failed", "stopped", "ambiguous", "discarded"]);

const pending = (child: StoredChild): boolean => child.state === "working" || child.state === "waiting";
const lineOf = (text: string): string | undefined => firstLine(text, SUMMARY_CHARS) || undefined;

/** Stopped by a boot or a lost worker, or failed as `interrupted`: Telar cut it off, so it is not the child's ending. */
function cutOffByTelar(turn: Turn): boolean {
  if (turn.state === "stopped") return turn.stopReason === "engine_restart" || turn.stopReason === "worker_unavailable";
  return turn.state === "failed" && turn.failure?.code === "interrupted";
}

type ChildrenHost = {
  find(sessionId: string): Session | undefined;
  turnsOf(sessionId: string): Turn[];
  liveTurns(sessionId: string): Turn[];
  runItems(sessionId: string, runId: string): Item[];
  hasScheduledWake(sessionId: string): boolean;
  waitsOnSubscription(sessionId: string): boolean;
  hasBackgroundWork(sessionId: string): boolean;
  announce(parentSessionId: string, notification: NotificationDetail): void;
};

/** One record per session a session tasked: its state, and how it ended, told to the parent once. */
export class SessionChildren {
  private cache: StoredChild[] | undefined;
  private byParent: Map<string, StoredChild[]> | undefined;

  constructor(
    private readonly kernel: Kernel,
    private readonly host: ChildrenHost,
  ) {
    kernel.onRollback(() => this.forget());
  }

  /** The parent's children, oldest first, with what each is doing now read from the child itself. */
  childrenOf(parentSessionId: string): SessionChild[] {
    return this.storedOf(parentSessionId).map((child) => {
      const session = this.host.find(child.sessionId);
      const title = session?.title ?? child.title;
      const progress = child.state === "working" && session ? childProgress(this.host.liveTurns(child.sessionId), (runId) => this.host.runItems(child.sessionId, runId)) : undefined;
      return {
        ...structuredClone(child),
        ...(title ? { title: title.slice(0, 200) } : {}),
        ...(session ? { provider: session.driver } : {}),
        ...(session?.model?.model ? { model: session.model.model } : {}),
        ...(progress ? { progress } : {}),
      };
    });
  }

  /** The children still out, as the activity fold waits on a subscription's target. */
  awaitedBy(parentSessionId: string): Subscription[] {
    return this.storedOf(parentSessionId).filter(pending).map((child) => ({
      id: `child_${child.sessionId}`,
      subscriberSessionId: parentSessionId,
      targetSessionId: child.sessionId,
      events: ["turn_completed"],
      createdAt: child.startedAt,
    }));
  }

  /** Parents a child still works for: a request it parks reaches them at once. */
  parentsOf(childSessionId: string): string[] {
    return this.read().filter((child) => child.sessionId === childSessionId && pending(child)).map((child) => child.parentSessionId);
  }

  /** A result from this child to this parent is told by the ending notice, not delivered on its own. */
  holds(parentSessionId: string, childSessionId: string): boolean {
    return this.read().some((child) => child.parentSessionId === parentSessionId && child.sessionId === childSessionId && pending(child));
  }

  /** The child is waiting on this parent's answer to its blocker. */
  waitingOn(parentSessionId: string, childSessionId: string): boolean {
    return this.read().some((child) => child.parentSessionId === parentSessionId && child.sessionId === childSessionId && child.state === "waiting");
  }

  /** A `task` registers or re-opens the recipient; a `result` ends it as done; a `blocker` makes it wait. */
  recordMessage(recipientSessionId: string, senderSessionId: string, intent: NonNullable<Turn["agentIntent"]>, message: { runId: string; body: string; senderRunId?: string }): void {
    if (intent === "task") this.register(senderSessionId, recipientSessionId, message.senderRunId);
    else if (intent === "result") {
      this.end(recipientSessionId, senderSessionId, "done", { summary: lineOf(message.body), fetch: { sessionId: recipientSessionId, runId: message.runId } });
    } else if (intent === "blocker") {
      this.update((child) => child.parentSessionId === recipientSessionId && child.sessionId === senderSessionId && child.state === "working", (child) => ({ ...child, state: "waiting" }));
    }
  }

  /**
   * A child's turn ended. Only on a parent's errand does it end the child: a failure or a stop does, and a completion
   * after which Telar will not run it again. Background-task turns, Telar's cut-offs and wakes off the errand never do.
   */
  turnEnded(sessionId: string, kind: WakeKind, turn: Turn, context: { resultText?: string; failure?: Turn["failure"] }): void {
    if (!TERMINAL_WAKE_KINDS.includes(kind)) return;
    if (turn.origin === "provider" && turn.providerReason?.kind === "background_task") return;
    if (cutOffByTelar(turn) && turn.stopReason !== "engine_restart") return;
    const out = this.read().filter((child) => child.sessionId === sessionId && pending(child));
    if (out.length === 0) return;
    const turns = this.host.turnsOf(sessionId);
    const woken = turn.origin === "session" && turn.wakeReason !== undefined;
    const fetch = { sessionId, runId: turn.runId };
    let again: boolean | undefined;
    for (const child of out) {
      if (kind === "turn_completed" && child.state === "waiting") continue;
      const errand = turns.some((each) => each.agentDelivery !== "passive" && each.sender?.sessionId === child.parentSessionId);
      if (woken && !errand) continue;
      if (kind === "turn_failed") {
        this.end(child.parentSessionId, sessionId, "failed", { summary: lineOf([context.failure?.code, context.failure?.message].filter(Boolean).join(": ")) ?? "failed", fetch });
      } else if (kind === "turn_stopped") {
        this.end(child.parentSessionId, sessionId, "stopped", { summary: turn.stopReason === "engine_restart" ? "cut off when the engine restarted" : "stopped", fetch });
      } else if (!(again ??= this.runsAgain(sessionId, turn.runId, turns))) {
        const said = lineOf(context.resultText ?? "");
        this.end(child.parentSessionId, sessionId, "done", { summary: firstLine(`finished without a result${said ? `: ${said}` : ""}`, SUMMARY_CHARS), fetch });
      }
    }
  }

  /** A child put away is done if it had ended and stopped if not; a parent put away takes its records with it. */
  review(): void {
    this.kernel.command("reviewChildren", () => {
      const all = this.read();
      const kept = all.filter((child) => {
        const parent = this.host.find(child.parentSessionId);
        return parent !== undefined && parent.state === "active" && parent.settledOverride !== "settled";
      });
      if (kept.length !== all.length) this.write(kept);
      for (const child of kept.filter(pending)) {
        const session = this.host.find(child.sessionId);
        const gone = !session ? "deleted" : session.state !== "active" ? "archived" : session.settledOverride === "settled" ? "settled" : undefined;
        if (gone) this.end(child.parentSessionId, child.sessionId, "stopped", { summary: gone });
      }
    });
  }

  /** The child now reports to `to`, or to no one. */
  handOver(childSessionId: string, fromSessionId: string, toSessionId: string | undefined): void {
    const all = this.read();
    const moving = all.find((child) => child.parentSessionId === fromSessionId && child.sessionId === childSessionId);
    if (!moving) return;
    const rest = all.filter((child) => child !== moving && !(child.parentSessionId === toSessionId && child.sessionId === childSessionId));
    this.write(toSessionId === undefined ? rest : [...rest, { ...moving, parentSessionId: toSessionId }]);
  }

  private register(parentSessionId: string, childSessionId: string, parentRunId: string | undefined): void {
    if (parentSessionId === childSessionId || this.host.find(parentSessionId)?.state !== "active") return;
    const all = this.read();
    // A task back to the session this one works for would make each wait on the other.
    if (all.some((child) => child.parentSessionId === childSessionId && child.sessionId === parentSessionId && pending(child))) return;
    const title = this.host.find(childSessionId)?.title;
    const record: StoredChild = {
      sessionId: childSessionId,
      parentSessionId,
      ...(parentRunId ? { parentRunId } : {}),
      ...(title ? { title: title.slice(0, 200) } : {}),
      state: "working",
      startedAt: this.kernel.now(),
    };
    this.write([...all.filter((child) => !(child.parentSessionId === parentSessionId && child.sessionId === childSessionId)), record]);
  }

  /** Ends a pending record once and tells the parent; an ended record is never told again. */
  private end(parentSessionId: string, childSessionId: string, state: Exclude<SessionChildState, "working" | "waiting">, ending: { summary?: string | undefined; fetch?: StoredChild["fetch"] }): void {
    let ended: StoredChild | undefined;
    this.update(
      (child) => child.parentSessionId === parentSessionId && child.sessionId === childSessionId && pending(child),
      (child) => (ended = { ...child, state, ...(ending.summary ? { summary: ending.summary } : {}), ...(ending.fetch ? { fetch: ending.fetch } : {}), endedAt: this.kernel.now() }),
    );
    if (!ended) return;
    const title = this.host.find(childSessionId)?.title ?? ended.title;
    const fetch = ended.fetch ?? this.latestRunOf(childSessionId);
    this.host.announce(parentSessionId, childEndingNotification({ sessionId: childSessionId, ...(title ? { title } : {}), state, ...(ended.summary ? { summary: ended.summary } : {}), ...(fetch ? { fetch } : {}) }));
  }

  private latestRunOf(sessionId: string): StoredChild["fetch"] {
    const latest = this.host.find(sessionId) ? this.host.turnsOf(sessionId).at(-1) : undefined;
    return latest ? { sessionId, runId: latest.runId } : undefined;
  }

  /** Telar will run this session again: a turn is waiting, a schedule is set, it waits on sessions of its own, or work it started in the background will wake it. */
  private runsAgain(sessionId: string, endedRunId: string, turns: Turn[]): boolean {
    return turns.some((turn) => turn.runId !== endedRunId && turn.agentDelivery !== "passive" && !ENDED_TURN_STATES.has(turn.state))
      || this.host.hasScheduledWake(sessionId)
      || this.storedOf(sessionId).some(pending)
      || this.host.waitsOnSubscription(sessionId)
      || this.host.hasBackgroundWork(sessionId);
  }

  private update(match: (child: StoredChild) => boolean, change: (child: StoredChild) => StoredChild): void {
    const all = this.read();
    let touched = false;
    const next = all.map((child) => {
      if (!match(child)) return child;
      touched = true;
      return change(child);
    });
    if (touched) this.write(next);
  }

  private storedOf(parentSessionId: string): StoredChild[] {
    if (!this.byParent) {
      const grouped = new Map<string, StoredChild[]>();
      for (const child of this.read()) grouped.set(child.parentSessionId, [...(grouped.get(child.parentSessionId) ?? []), child]);
      for (const children of grouped.values()) children.sort((a, b) => a.startedAt - b.startedAt);
      this.byParent = grouped;
    }
    return this.byParent.get(parentSessionId) ?? [];
  }

  private read(): StoredChild[] {
    if (!this.cache) {
      const stored = this.kernel.readDocument(this.kernel.paths.children) as { children?: unknown } | undefined;
      const parsed = StoredChild.array().safeParse(stored?.children ?? []);
      // A torn document costs the records, not the engine; each fact is still in the journals.
      this.cache = parsed.success ? parsed.data : [];
    }
    return this.cache;
  }

  private write(children: StoredChild[]): void {
    const now = this.kernel.now();
    const fresh = children.filter((child) => pending(child) || now - (child.endedAt ?? now) < KEEP_ENDED_MS);
    const counts = new Map<string, number>();
    const kept = [...fresh].reverse().filter((child) => {
      const seen = (counts.get(child.parentSessionId) ?? 0) + 1;
      counts.set(child.parentSessionId, seen);
      return pending(child) || seen <= MAX_PER_PARENT;
    }).reverse();
    this.forget();
    this.kernel.writeDocument(this.kernel.paths.children, { version: STATE_VERSION, children: kept });
  }

  private forget(): void {
    this.cache = undefined;
    this.byParent = undefined;
  }
}
