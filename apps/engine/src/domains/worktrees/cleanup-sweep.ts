import type { Session, SettlingOptions } from "@telar/engine-client";
import type { CleanupCandidate } from "../storage";
import { liveCheckouts } from "./boot-pass";

export function cleanupCandidates(sessions: readonly Session[], at: SettlingOptions): CleanupCandidate[] {
  const live = new Set(liveCheckouts(sessions, at).map((checkout) => checkout.sessionId));
  return sessions.flatMap((session) => {
    if (session.workspace.mode !== "worktree" || !session.projectId) return [];
    const archived = session.state === "archived";
    const active = Math.max(session.updatedAt, session.lastTurnEndedAt ?? 0, session.activityAt ?? 0);
    const settledAt = archived ? active : ((session.settledOverride === "settled" ? session.settledAt : undefined) ?? active);
    return [
      {
        sessionId: session.id,
        path: session.workspace.path,
        archived,
        released: session.workspace.released !== undefined,
        ...(!archived && live.has(session.id) ? {} : { settledAt }),
      },
    ];
  });
}
