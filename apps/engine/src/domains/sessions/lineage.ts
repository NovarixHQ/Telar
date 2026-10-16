import { z } from "zod";
import { Id, SessionChild, type Item, type NotificationDetail, type Session, type SessionChildState, type Subscription, type Turn } from "@telar/engine-client";
import { STATE_VERSION, type Kernel } from "../../platform/kernel";
import { childEndingNotification, firstLine } from "../turns";
import { childProgress } from "./child-progress";
import { cutOffByTelar, livenessOf, type SessionSubtree } from "./liveness";

const StoredNode = SessionChild.omit({ provider: true, model: true, progress: true, blocked: true, updatedAt: true }).extend({
  rootSessionId: Id,
  generation: z.number().int().positive(),
  live: z.array(z.string()).optional(),
  nudgedRunId: Id.optional(),
  stopRequested: z.literal(true).optional(),
});
type StoredNode = z.infer<typeof StoredNode>;
type Ending = Exclude<SessionChildState, "working" | "waiting">;

const SUMMARY_CHARS = 200;
const KEEP_ENDED_MS = 7 * 24 * 60 * 60_000;
const MAX_PER_PARENT = 100;
const MAX_SETTLE_PASSES = 8;
const ENDED_TURN_STATES: ReadonlySet<Turn["state"]> = new Set(["completed", "failed", "stopped"]);
const LEFT_IDLE = "ended without a result and nothing is running there, so it will not continue on its own.";

const out = (state: SessionChildState): boolean => state === "working" || state === "waiting";
const pending = (node: StoredNode): boolean => out(node.state);
const lineOf = (text: string): string | undefined => firstLine(text, SUMMARY_CHARS) || undefined;
const sameReasons = (a: readonly string[] | undefined, b: readonly string[]): boolean => a !== undefined && a.length === b.length && a.every((reason, index) => reason === b[index]);

// The newest turn the child's model ran.
function lastOwnTurn(turns: Turn[]): Turn | undefined {
  return turns
    .filter((turn) => turn.agentDelivery !== "passive" && ENDED_TURN_STATES.has(turn.state))
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .at(-1);
}

function stopSummary(turn: Turn): string {
  if (turn.stopReason === "engine_restart") return "cut off when the engine restarted";
  return cutOffByTelar(turn) ? "cut off when its worker went away" : "stopped";
}

type LineageHost = {
  find(sessionId: string): Session | undefined;
  subtree(sessionId: string): Omit<SessionSubtree, "workingBuilders" | "now">;
  liveTurns(sessionId: string): Turn[];
  runItems(sessionId: string, runId: string): Item[];
  deliver(ending: { parentSessionId: string; childSessionId: string; generation: number; notification: NotificationDetail }): void;
  settleDeliveries(): boolean;
  sweepDeliveries(): void;
  nudge(sessionId: string, endedRunId: string): boolean;
};

/**
 * The session nodes of the lineage tree: who tasked whom, under which root, and each child's derived liveness.
 * Turn and task nodes stay in the stores that write them; a child ends only when nothing below it is live.
 */
export class SessionLineage {
  private cache: StoredNode[] | undefined;
  private byParent: Map<string, StoredNode[]> | undefined;
  private pendingIds: Set<string> | undefined;
  private readonly dirty = new Set<string>();

  constructor(
    private readonly kernel: Kernel,
    private readonly host: LineageHost,
  ) {
    kernel.onRollback(() => {
      this.forget();
      this.dirty.clear();
    });
    kernel.beforeCommit(() => this.settle());
  }

  touch(sessionId: string): void {
    this.pendingIds ??= new Set(this.read().filter(pending).map((node) => node.sessionId));
    if (this.pendingIds.has(sessionId)) this.dirty.add(sessionId);
  }

  /** Every pending child, rechecked: what a boot or the sweep runs, since nothing writes when a grace or a schedule lapses. */
  sweep(): void {
    this.kernel.command("sweepLineage", () => {
      this.review();
      for (const node of this.read().filter(pending)) this.dirty.add(node.sessionId);
      this.host.sweepDeliveries();
    });
  }

  /** The parent's children, oldest first, with what each is doing now read from the child itself. */
  childrenOf(parentSessionId: string): SessionChild[] {
    return this.storedOf(parentSessionId).map(({ rootSessionId: _root, generation: _generation, live: _live, nudgedRunId: _nudged, stopRequested: _stop, ...child }) => {
      const session = this.host.find(child.sessionId);
      const title = session?.title ?? child.title;
      const progress = child.state === "working" && session ? childProgress(this.host.liveTurns(child.sessionId), (runId) => this.host.runItems(child.sessionId, runId)) : undefined;
      return {
        ...structuredClone(child),
        ...(title ? { title: title.slice(0, 200) } : {}),
        ...(session ? { provider: session.driver } : {}),
        ...(session?.model?.model ? { model: session.model.model } : {}),
        ...(progress ? { progress } : {}),
        ...(out(child.state) && session?.activity === "blocked" ? { blocked: true } : {}),
        updatedAt: Math.max(child.endedAt ?? child.startedAt, out(child.state) ? (session?.updatedAt ?? 0) : 0),
      };
    });
  }

  /** The children still out, as the activity fold waits on a subscription's target. */
  awaitedBy(parentSessionId: string): Subscription[] {
    return this.storedOf(parentSessionId).filter(pending).map((node) => ({
      id: `child_${node.sessionId}`,
      subscriberSessionId: parentSessionId,
      targetSessionId: node.sessionId,
      events: ["turn_completed"],
      createdAt: node.startedAt,
    }));
  }

  /** Parents a child still works for: a request it parks reaches them at once. */
  parentsOf(childSessionId: string): string[] {
    return this.read().filter((node) => node.sessionId === childSessionId && pending(node)).map((node) => node.parentSessionId);
  }

  /** A result from this child to this parent is told by the ending notice, not delivered on its own. */
  holds(parentSessionId: string, childSessionId: string): boolean {
    return this.read().some((node) => node.parentSessionId === parentSessionId && node.sessionId === childSessionId && pending(node));
  }

  coversRun(parentSessionId: string, childSessionId: string, turn: Turn): boolean {
    const node = this.read().find((each) => each.parentSessionId === parentSessionId && each.sessionId === childSessionId);
    return node !== undefined && (pending(node) || (turn.startedAt ?? turn.acceptedAt) <= (node.endedAt ?? 0));
  }

  /** The child is waiting on this parent's answer to its blocker. */
  waitingOn(parentSessionId: string, childSessionId: string): boolean {
    return this.read().some((node) => node.parentSessionId === parentSessionId && node.sessionId === childSessionId && node.state === "waiting");
  }

  /** A `task` registers or re-opens the recipient; a `result` ends it as done; a `blocker` makes it wait. */
  recordMessage(recipientSessionId: string, senderSessionId: string, intent: NonNullable<Turn["agentIntent"]>, message: { runId: string; body: string; senderRunId?: string }): void {
    if (intent === "task") this.register(senderSessionId, recipientSessionId, message.senderRunId);
    else if (intent === "result") {
      const node = this.pendingNode(recipientSessionId, senderSessionId);
      if (node) this.end(node, "done", { summary: lineOf(message.body), fetch: { sessionId: recipientSessionId, runId: message.runId } });
    } else if (intent === "blocker") {
      this.update((node) => node.parentSessionId === recipientSessionId && node.sessionId === senderSessionId && node.state === "working", (node) => ({ ...node, state: "waiting" }));
    }
  }

  noteStopped(sessionId: string): void {
    this.update((node) => node.sessionId === sessionId && pending(node), (node) => ({ ...node, stopRequested: true }));
    this.touch(sessionId);
  }

  /** A child put away is stopped; a parent put away takes its records with it. */
  review(): void {
    this.kernel.command("reviewChildren", () => {
      const all = this.read();
      const kept = all.filter((node) => {
        const parent = this.host.find(node.parentSessionId);
        return parent !== undefined && parent.state === "active" && parent.settledOverride !== "settled";
      });
      if (kept.length !== all.length) this.write(kept);
      for (const node of kept.filter(pending)) {
        const session = this.host.find(node.sessionId);
        const gone = !session ? "deleted" : session.state !== "active" ? "archived" : session.settledOverride === "settled" ? "settled" : undefined;
        if (gone) this.end(node, "stopped", { summary: gone });
      }
    });
  }

  /** The child now reports to `to`, or to no one. */
  handOver(childSessionId: string, fromSessionId: string, toSessionId: string | undefined): void {
    const all = this.read();
    const moving = all.find((node) => node.parentSessionId === fromSessionId && node.sessionId === childSessionId);
    if (!moving) return;
    const rest = all.filter((node) => node !== moving && !(node.parentSessionId === toSessionId && node.sessionId === childSessionId));
    if (toSessionId === undefined) return this.write(rest);
    const rootSessionId = this.rootOf(toSessionId);
    this.write([...rest.map((node) => (node.rootSessionId === moving.rootSessionId && this.descends(node, childSessionId, rest) ? { ...node, rootSessionId } : node)), { ...moving, parentSessionId: toSessionId, rootSessionId }]);
    this.touch(childSessionId);
  }

  migrate(): number | undefined {
    if (this.kernel.readDocument(this.kernel.paths.lineage) !== undefined) return undefined;
    const legacy = this.kernel.readDocument(this.kernel.paths.children) as { children?: unknown } | undefined;
    if (legacy === undefined) return undefined;
    const parsed = StoredNode.omit({ rootSessionId: true, generation: true }).array().safeParse(legacy.children ?? []);
    const records = parsed.success ? parsed.data : [];
    return this.kernel.command("migrateChildrenToLineage", () => {
      const parents = new Map(records.filter((record) => out(record.state)).map((record) => [record.sessionId, record.parentSessionId]));
      const rootOf = (sessionId: string): string => {
        let root = sessionId;
        for (let hops = 0; parents.has(root) && hops < 32; hops += 1) root = parents.get(root)!;
        return root;
      };
      this.write(records.map((record) => ({ ...record, rootSessionId: rootOf(record.parentSessionId), generation: 1 })));
      this.kernel.executionStore.statement("DELETE FROM documents WHERE key=?").run("children.json");
      for (const record of records.filter((each) => out(each.state))) this.dirty.add(record.sessionId);
      return records.length;
    });
  }

  private settle(): void {
    for (let pass = 0; pass < MAX_SETTLE_PASSES; pass += 1) {
      const batch = [...this.dirty];
      this.dirty.clear();
      for (const sessionId of batch) {
        try {
          this.evaluate(sessionId);
        } catch (error) {
          console.warn(`[engine] could not settle the lineage of ${sessionId}:`, error);
        }
      }
      if (!this.host.settleDeliveries() && this.dirty.size === 0) return;
    }
  }

  private evaluate(sessionId: string): void {
    const nodes = this.read().filter((node) => node.sessionId === sessionId && pending(node));
    if (nodes.length === 0) return;
    const workingBuilders = this.storedOf(sessionId).filter((node) => node.state === "working").map((node) => node.sessionId);
    const subtree = this.host.subtree(sessionId);
    const live = livenessOf({ ...subtree, workingBuilders, now: this.kernel.now() });
    if (nodes.some((node) => !sameReasons(node.live, live))) this.update((node) => node.sessionId === sessionId && pending(node), (node) => ({ ...node, live }));
    if (live.length > 0) return;
    const last = lastOwnTurn(subtree.recentTurns);
    let nudged: boolean | undefined;
    for (const node of this.read().filter((each) => each.sessionId === sessionId && pending(each))) {
      const fetch = last ? { sessionId, runId: last.runId } : undefined;
      if (node.stopRequested) this.end(node, "stopped", { summary: "its work was stopped", fetch });
      else if (last?.state === "failed" && !cutOffByTelar(last)) {
        this.end(node, "failed", { summary: lineOf([last.failure?.code, last.failure?.message].filter(Boolean).join(": ")) ?? "failed", fetch });
      } else if (last && (last.state === "stopped" || cutOffByTelar(last))) this.end(node, "stopped", { summary: stopSummary(last), fetch });
      else if (node.state === "waiting") continue;
      else if (!node.nudgedRunId && last && (nudged ??= this.host.nudge(sessionId, last.runId))) {
        this.update((each) => each === node, (each) => ({ ...each, nudgedRunId: last.runId }));
      } else {
        const said = lineOf(last?.resultText ?? "");
        this.end(node, "done", { summary: firstLine(`${LEFT_IDLE}${said ? ` It last said: ${said}` : ""}`, SUMMARY_CHARS), fetch });
      }
    }
  }

  private register(parentSessionId: string, childSessionId: string, parentRunId: string | undefined): void {
    if (parentSessionId === childSessionId || this.host.find(parentSessionId)?.state !== "active") return;
    const all = this.read();
    // A task back to the session this one works for would make each wait on the other.
    if (all.some((node) => node.parentSessionId === childSessionId && node.sessionId === parentSessionId && pending(node))) return;
    const previous = all.find((node) => node.parentSessionId === parentSessionId && node.sessionId === childSessionId);
    const title = this.host.find(childSessionId)?.title;
    const node: StoredNode = {
      sessionId: childSessionId,
      parentSessionId,
      rootSessionId: this.rootOf(parentSessionId),
      generation: (previous?.generation ?? 0) + 1,
      ...(parentRunId ? { parentRunId } : {}),
      ...(title ? { title: title.slice(0, 200) } : {}),
      state: "working",
      startedAt: this.kernel.now(),
    };
    this.write([...all.filter((each) => each !== previous), node]);
    this.dirty.add(childSessionId);
  }

  /** Ends a pending node once and tells the parent; an ended node is never told again. */
  private end(node: StoredNode, state: Ending, ending: { summary?: string | undefined; fetch?: StoredNode["fetch"] }): void {
    let ended: StoredNode | undefined;
    this.update(
      (each) => each.parentSessionId === node.parentSessionId && each.sessionId === node.sessionId && pending(each),
      (each) => (ended = { ...each, state, ...(ending.summary ? { summary: ending.summary } : {}), ...(ending.fetch ? { fetch: ending.fetch } : {}), endedAt: this.kernel.now() }),
    );
    if (!ended) return;
    this.touch(node.parentSessionId);
    const title = this.host.find(node.sessionId)?.title ?? ended.title;
    const notification = childEndingNotification({ sessionId: node.sessionId, ...(title ? { title } : {}), state, ...(ended.summary ? { summary: ended.summary } : {}), ...(ended.fetch ? { fetch: ended.fetch } : {}) });
    this.host.deliver({ parentSessionId: node.parentSessionId, childSessionId: node.sessionId, generation: node.generation, notification });
  }

  private pendingNode(parentSessionId: string, childSessionId: string): StoredNode | undefined {
    return this.read().find((node) => node.parentSessionId === parentSessionId && node.sessionId === childSessionId && pending(node));
  }

  private rootOf(sessionId: string): string {
    return this.read().find((node) => node.sessionId === sessionId && pending(node))?.rootSessionId ?? sessionId;
  }

  private descends(node: StoredNode, ancestor: string, all: StoredNode[]): boolean {
    let parent: string | undefined = node.parentSessionId;
    for (let hops = 0; parent && hops < 32; hops += 1) {
      if (parent === ancestor) return true;
      parent = all.find((each) => each.sessionId === parent && pending(each))?.parentSessionId;
    }
    return false;
  }

  private update(match: (node: StoredNode) => boolean, change: (node: StoredNode) => StoredNode): void {
    let touched = false;
    const next = this.read().map((node) => {
      if (!match(node)) return node;
      touched = true;
      return change(node);
    });
    if (touched) this.write(next);
  }

  private storedOf(parentSessionId: string): StoredNode[] {
    if (!this.byParent) {
      const grouped = new Map<string, StoredNode[]>();
      for (const node of this.read()) grouped.set(node.parentSessionId, [...(grouped.get(node.parentSessionId) ?? []), node]);
      for (const nodes of grouped.values()) nodes.sort((a, b) => a.startedAt - b.startedAt);
      this.byParent = grouped;
    }
    return this.byParent.get(parentSessionId) ?? [];
  }

  private read(): StoredNode[] {
    if (!this.cache) {
      const stored = this.kernel.readDocument(this.kernel.paths.lineage) as { nodes?: unknown } | undefined;
      const parsed = StoredNode.array().safeParse(stored?.nodes ?? []);
      // A torn document costs the records, not the engine; each fact is still in the journals.
      this.cache = parsed.success ? parsed.data : [];
    }
    return this.cache;
  }

  private write(nodes: StoredNode[]): void {
    const now = this.kernel.now();
    const fresh = nodes.filter((node) => pending(node) || now - (node.endedAt ?? now) < KEEP_ENDED_MS);
    const counts = new Map<string, number>();
    const kept = [...fresh].reverse().filter((node) => {
      const seen = (counts.get(node.parentSessionId) ?? 0) + 1;
      counts.set(node.parentSessionId, seen);
      return pending(node) || seen <= MAX_PER_PARENT;
    }).reverse();
    this.forget();
    this.kernel.writeDocument(this.kernel.paths.lineage, { version: STATE_VERSION, nodes: kept });
  }

  private forget(): void {
    this.cache = undefined;
    this.byParent = undefined;
    this.pendingIds = undefined;
  }
}
