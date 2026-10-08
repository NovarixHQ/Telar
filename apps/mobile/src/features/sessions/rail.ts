import {
  DEFAULT_AUTO_SETTLE_HOURS,
  hasUnreadResult,
  isShelved,
  isSnoozed,
  settlingActivityOf,
  type LiveSessionRow,
  type LiveSessionsAnswer,
} from "@telar/engine-client";

type RailStatus = { label: string; tone: "needs-you" | "working" | "failed" | "quiet" };

export type RailRow = {
  key: string;
  hostId: string;
  sessionId: string;
  title: string;
  projectName?: string;
  status: RailStatus;
  unread: boolean;
  lastActivity: number;
};

export type HostInbox = { hostId: string; answer: LiveSessionsAnswer | undefined };

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

const lastActivityOf = (session: Pick<LiveSessionRow, "updatedAt" | "activityAt" | "lastTurnEndedAt">): number => Math.max(session.updatedAt, session.activityAt ?? 0, session.lastTurnEndedAt ?? 0);

function statusOf(session: Pick<LiveSessionRow, "activity" | "lastTurnFailed" | "updatedAt" | "activityAt" | "lastTurnEndedAt">, now: number): RailStatus {
  switch (session.activity) {
    case "blocked":
      return { label: "Needs you", tone: "needs-you" };
    case "working":
      return { label: "Working", tone: "working" };
    case "queued":
      return { label: "Queued", tone: "working" };
    case "monitoring":
      return { label: "Monitoring", tone: "working" };
    default:
      return session.lastTurnFailed ? { label: "Failed", tone: "failed" } : { label: ago(lastActivityOf(session), now), tone: "quiet" };
  }
}

/** The active rows of every host, newest activity first; settled and snoozed sessions stay off the rail. */
export function railRows(inboxes: readonly HostInbox[], now: number): RailRow[] {
  const rows: RailRow[] = [];
  for (const { hostId, answer } of inboxes) {
    if (!answer) continue;
    const options = { now, autoSettleAfterHours: answer.inbox ? answer.inbox.autoSettleAfterHours : DEFAULT_AUTO_SETTLE_HOURS };
    const projects = new Map(answer.projects.map((project) => [project.id, project.name]));
    for (const row of answer.sessions) {
      const session = { ...row, archived: row.state === "archived", draft: row.draft !== undefined };
      const activity = settlingActivityOf(session);
      if (isSnoozed(session, activity, options) || isShelved(session, activity, options)) continue;
      const working = activity.working || session.activity === "blocked";
      rows.push({
        key: `${hostId}/${session.id}`,
        hostId,
        sessionId: session.id,
        title: session.title.trim() || "Untitled session",
        ...(session.projectId && projects.has(session.projectId) ? { projectName: projects.get(session.projectId)! } : {}),
        status: statusOf(session, now),
        unread: !working && hasUnreadResult(session),
        lastActivity: lastActivityOf(session),
      });
    }
  }
  return rows.sort((left, right) => right.lastActivity - left.lastActivity || left.key.localeCompare(right.key));
}
