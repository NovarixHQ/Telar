import type { Session, SessionAssignment } from "@telar/engine-client";
import { assertId, EngineStateError, type JournalEntry, type Kernel } from "../../platform/kernel";
import type { SessionLifecycle } from "./lifecycle-store";
import { sessionMetadataFile, storedSession } from "./metadata";
import type { SessionRecords } from "./records";
import type { SessionSubscriptions } from "./subscriptions";

type HandoffDeps = {
  records: SessionRecords;
  lifecycle: Pick<SessionLifecycle, "detachAssignments">;
  subscriptions: Pick<SessionSubscriptions, "handOver">;
  assignments(sessionId: string): SessionAssignment[];
  appendEvent(sessionId: string, event: JournalEntry): unknown;
};

function parentIdOf(session: Pick<Session, "id" | "startedFrom">, assignments: readonly SessionAssignment[]): string | undefined {
  const first = assignments.filter((each) => each.outcome !== "detached").sort((a, b) => a.receivedAt - b.receivedAt)[0];
  const parent = session.startedFrom?.sessionId ?? first?.fromSessionId;
  return parent === session.id ? undefined : parent;
}

export class SessionHandoff {
  constructor(
    private readonly kernel: Kernel,
    private readonly deps: HandoffDeps,
  ) {}

  parentOf(sessionId: string): string | undefined {
    return parentIdOf(this.deps.records.require(sessionId), this.deps.assignments(sessionId));
  }

  handOff(sessionId: string, input: { to?: string; by?: string }): Session {
    return this.kernel.command("handOffSession", () => {
      const session = this.deps.records.require(sessionId);
      if (session.state !== "active") throw new EngineStateError("conflict", "an archived session reports to no one");
      const from = this.parentOf(sessionId);
      if (input.by !== undefined && input.by !== from) {
        throw new EngineStateError("conflict","only the session this one reports to can hand it off; ask the person to move it from the rail");
      }
      if (input.to !== undefined) this.assertTarget(sessionId, input.to);
      if (from === input.to) return this.deps.records.get(sessionId);

      this.deps.lifecycle.detachAssignments(sessionId);
      const { startedFrom: _old, ...rest } = this.deps.records.require(sessionId);
      const next: Session = { ...rest, ...(input.to ? { startedFrom: { sessionId: input.to } } : {}), updatedAt: this.kernel.now() };
      this.kernel.writeDocument(sessionMetadataFile(this.kernel.paths, sessionId), storedSession(next));
      this.deps.appendEvent(sessionId, { type: "session.updated", session: next });
      if (from !== undefined) this.deps.subscriptions.handOver(sessionId, from, input.to);

      const moved: JournalEntry = { type: "session.handed_off", subject: sessionId, ...(from ? { from } : {}), ...(input.to ? { to: input.to } : {}) };
      const known = new Set(this.deps.records.ids());
      for (const id of new Set([sessionId, from, input.to])) if (id !== undefined && known.has(id)) this.deps.appendEvent(id, moved);
      return this.deps.records.get(sessionId);
    });
  }

  private assertTarget(sessionId: string, to: string): void {
    assertId(to, "target session id");
    if (to === sessionId) throw new EngineStateError("invalid_request", "a session cannot report to itself");
    if (this.deps.records.require(to).state !== "active") throw new EngineStateError("conflict", "an archived session cannot take a sub-session");
    const seen = new Set<string>();
    for (let at: string | undefined = to; at !== undefined && !seen.has(at); at = this.parentOfIfAny(at)) {
      if (at === sessionId) throw new EngineStateError("invalid_request", "that session reports to this one, so the move would make a loop");
      seen.add(at);
    }
  }

  private parentOfIfAny(sessionId: string): string | undefined {
    try {
      return this.parentOf(sessionId);
    } catch (error) {
      if (error instanceof EngineStateError && error.code === "not_found") return undefined;
      throw error;
    }
  }
}
