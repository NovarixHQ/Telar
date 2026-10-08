import {
  DEFAULT_AUTO_SETTLE_HOURS,
  hasUnreadResult,
  isShelved,
  isSnoozed,
  settlingActivityOf,
  type LiveSessionRow,
  type LiveSessionsAnswer,
} from "@telar/engine-client";
import type { ConnectionState } from "../../platform/connection";

export type RailStatus =
  | { kind: "snoozed"; label: string }
  | { kind: "needs-you" }
  | { kind: "working"; label: "Working" | "Queued" }
  | { kind: "monitoring" }
  | { kind: "failed" }
  | { kind: "idle"; label: string };

export type RailRow = {
  key: string;
  hostId: string;
  sessionId: string;
  title: string;
  projectId?: string;
  projectName?: string;
  projectIconName?: string;
  projectIconEmoji?: string;
  driver: string;
  branch?: string;
  pinned: boolean;
  unread: boolean;
  status: RailStatus;
  accent?: "amber" | "accent";
  createdAt: number;
  updatedAt: number;
  lastActivity: number;
};

export type RailSections = { active: RailRow[]; snoozed: RailRow[]; settled: RailRow[] };

export type HostInbox = { hostId: string; answer: LiveSessionsAnswer | undefined };

const UNITS: [number, string][] = [
  [365 * 86_400_000, "y"],
  [30 * 86_400_000, "mo"],
  [7 * 86_400_000, "w"],
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
  [1000, "s"],
];

/** RelativeDateTimeFormatter's abbreviated style in English: "11h ago", "in 3h". */
export function relativeTime(at: number, now: number): string {
  const distance = Math.abs(now - at);
  const [size, unit] = UNITS.find(([size]) => distance >= size) ?? UNITS[UNITS.length - 1]!;
  const count = Math.floor(distance / size);
  return at > now ? `in ${count}${unit}` : `${count}${unit} ago`;
}

const lastActivityOf = (session: Pick<LiveSessionRow, "updatedAt" | "activityAt" | "lastTurnEndedAt">): number => Math.max(session.updatedAt, session.activityAt ?? 0, session.lastTurnEndedAt ?? 0);

function statusOf(session: LiveSessionRow, now: number): RailStatus {
  if (session.snoozedUntil !== undefined && session.snoozedUntil > now && session.activity !== "blocked") return { kind: "snoozed", label: relativeTime(session.snoozedUntil, now) };
  switch (session.activity) {
    case "blocked":
      return { kind: "needs-you" };
    case "working":
      return { kind: "working", label: "Working" };
    case "queued":
      return { kind: "working", label: "Queued" };
    case "monitoring":
      return { kind: "monitoring" };
    default:
      return session.lastTurnFailed ? { kind: "failed" } : { kind: "idle", label: relativeTime(session.activityAt ?? session.updatedAt, now) };
  }
}

function accentOf(activity: LiveSessionRow["activity"]): RailRow["accent"] {
  if (activity === "blocked") return "amber";
  return activity === "working" || activity === "queued" || activity === "monitoring" ? "accent" : undefined;
}

/** Newest-created first, then most recently updated, then id: how the merged inbox lists active rows. */
const createdNewestFirst = (left: RailRow, right: RailRow): number =>
  right.createdAt - left.createdAt || right.updatedAt - left.updatedAt || (left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);

/** Every host's sessions merged into active, snoozed and settled, each host settling by its own policy. */
export function railSections(inboxes: readonly HostInbox[], now: number, filter?: string): RailSections {
  const sections: RailSections = { active: [], snoozed: [], settled: [] };
  for (const { hostId, answer } of inboxes) {
    if (!answer || (filter !== undefined && filter !== hostId)) continue;
    const options = { now, autoSettleAfterHours: answer.inbox ? answer.inbox.autoSettleAfterHours : DEFAULT_AUTO_SETTLE_HOURS };
    const projects = new Map(answer.projects.map((project) => [project.id, project]));
    for (const row of answer.sessions) {
      const session = { ...row, archived: row.state === "archived", draft: row.draft !== undefined };
      const activity = settlingActivityOf(session);
      const busy = activity.working || row.activity === "blocked";
      const project = row.projectId ? projects.get(row.projectId) : undefined;
      const entry: RailRow = {
        key: `${hostId}/${row.id}`,
        hostId,
        sessionId: row.id,
        title: row.title.trim() || "Untitled session",
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(project ? { projectName: project.name } : {}),
        ...(project?.iconName ? { projectIconName: project.iconName } : {}),
        ...(project?.iconEmoji ? { projectIconEmoji: project.iconEmoji } : {}),
        driver: row.driver,
        ...(row.workspace.mode === "worktree" ? { branch: row.workspace.branch } : {}),
        pinned: row.settledOverride === "active",
        unread: !busy && hasUnreadResult(session),
        status: statusOf(row, now),
        ...(accentOf(row.activity) ? { accent: accentOf(row.activity)! } : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastActivity: lastActivityOf(row),
      };
      if (isSnoozed(session, activity, options)) sections.snoozed.push(entry);
      else if (isShelved(session, activity, options)) sections.settled.push(entry);
      else sections.active.push(entry);
    }
  }
  sections.active.sort(createdNewestFirst);
  sections.snoozed.sort((left, right) => right.updatedAt - left.updatedAt);
  sections.settled.sort((left, right) => right.updatedAt - left.updatedAt);
  return sections;
}

/** The flat rail: pinned rows in each host's saved pin order, then the rest by newest activity. */
export function flatRail(active: readonly RailRow[], pinnedOrders: ReadonlyMap<string, readonly string[]>): { pinned: RailRow[]; rows: RailRow[] } {
  const ranked: { rank: number; arrived: number; row: RailRow }[] = [];
  const unranked: RailRow[] = [];
  active.forEach((row, arrived) => {
    if (!row.pinned) return;
    const rank = pinnedOrders.get(row.hostId)?.indexOf(row.sessionId) ?? -1;
    if (rank >= 0) ranked.push({ rank, arrived, row });
    else unranked.push(row);
  });
  ranked.sort((left, right) => left.rank - right.rank || left.arrived - right.arrived);
  const rows = active.filter((row) => !row.pinned).sort((left, right) => right.lastActivity - left.lastActivity || createdNewestFirst(left, right));
  return { pinned: [...ranked.map((entry) => entry.row), ...unranked], rows };
}

export type HostHealth = { hostId: string; name: string; state: ConnectionState["kind"]; failed?: string; answered: boolean };
export type HostFailure = { hostId: string; name: string; needsPairing: boolean; stale: boolean };

/** Computers whose list could not be read: unpaired ones, and unreachable ones whose saved rows still show. */
export function hostFailures(hosts: readonly HostHealth[]): HostFailure[] {
  return hosts.flatMap((host) => {
    const needsPairing = host.state === "blocked";
    if (!needsPairing && host.state !== "backoff" && !host.failed) return [];
    return [{ hostId: host.hostId, name: host.name, needsPairing, stale: host.answered }];
  });
}

const fold =(text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Rows whose title, project or computer contains the query, ignoring case and accents. */
export function searchRail(rows: readonly RailRow[], query: string, hostName: (hostId: string) => string | undefined): RailRow[] {
  const needle = fold(query.trim());
  if (!needle) return [...rows];
  return rows.filter((row) => [row.title, row.projectName ?? "", hostName(row.hostId) ?? ""].some((field) => fold(field).includes(needle)));
}
