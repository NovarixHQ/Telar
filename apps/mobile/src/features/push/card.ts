import type { LiveSessionRow } from "@telar/engine-client";

export const CARD_STALE_SECONDS = 600;
const MAX_ROWS = 5;

export type CardSession = Pick<LiveSessionRow, "id" | "title" | "activity" | "activityDetail" | "activityAt" | "projectId" | "startedFrom">;
export type CardHost = { hostId: string; name: string; sessions: readonly CardSession[]; projects: ReadonlyMap<string, string> };

/** Mirrors `SessionActivityRow` in the widget; the field names are its Codable keys. */
type CardRow = { id: string; status: string; title?: string; project?: string; workers?: number; hostId?: string; host?: string };

/** Mirrors `SessionActivityAttributes.ContentState`; dates are seconds since 1970. */
export type CardState = {
  title: string;
  status: string;
  updatedAt: number;
  startedAt: number;
  ended: boolean;
  sessionId?: string;
  activeCount: number;
  rows: CardRow[];
  hostId?: string;
};

const RANKS: Partial<Record<string, number>> = { blocked: 0, working: 1, queued: 2, monitoring: 4 };
const STATUSES: Partial<Record<string, string>> = { blocked: "Needs you", working: "Working", queued: "Queued", monitoring: "Background" };

const waitingOn = (session: CardSession): number | undefined => (session.activityDetail?.kind === "session" ? session.activityDetail.sessions : undefined);
const rank = (session: CardSession): number | undefined => (waitingOn(session) !== undefined ? 3 : RANKS[session.activity ?? "idle"]);

function status(session: CardSession): string {
  const waiting = waitingOn(session);
  if (waiting !== undefined) return waiting > 1 ? `Waiting on ${waiting} sessions` : "Waiting on a session";
  return STATUSES[session.activity ?? "idle"] ?? "Working";
}

export const isCardActive = (session: CardSession): boolean => rank(session) !== undefined;

export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  const characters = [...trimmed];
  return characters.length > max ? `${characters.slice(0, max - 1).join("").trimEnd()}…` : trimmed;
}

/** Groups sessions under the session that started them; families with nothing active are dropped. */
function families(sessions: readonly CardSession[]): { root: CardSession; active: CardSession[] }[] {
  const byId = new Map<string, CardSession>();
  for (const session of sessions) if (!byId.has(session.id)) byId.set(session.id, session);
  const rootOf = (session: CardSession): CardSession => {
    const seen = new Set([session.id]);
    let current = session;
    for (let parent = byId.get(current.startedFrom?.sessionId ?? ""); parent; parent = byId.get(current.startedFrom?.sessionId ?? "")) {
      if (seen.has(parent.id)) return session;
      seen.add(parent.id);
      current = parent;
    }
    return current;
  };
  const active = new Map<string, CardSession[]>();
  for (const session of sessions) {
    const top = rootOf(session).id;
    const list = active.get(top) ?? [];
    active.set(top, list);
    if (isCardActive(session)) list.push(session);
  }
  return [...active].filter(([, list]) => list.length > 0).map(([id, list]) => ({ root: byId.get(id)!, active: list }));
}

/** The card's first state, built from every computer's active sessions the way the Swift app's AutomaticCard does. */
export function initialCardState(hosts: readonly CardHost[], previews: boolean, now: number): CardState {
  const live = hosts.map((host) => ({ host, families: families(host.sessions) })).filter((entry) => entry.families.length > 0);
  const ranked = live.flatMap(({ host, families }) =>
    families.map(({ root, active }) => {
      const title = root.title.trim();
      const workers = active.filter((session) => session.id !== root.id).length;
      const lead = active.reduce((best, session) => (rank(session)! < rank(best)! ? session : best));
      const project = [root, ...active].map((session) => (session.projectId ? host.projects.get(session.projectId) : undefined)).find((name) => name !== undefined);
      const row: CardRow = {
        id: root.id,
        status: status(lead),
        ...(previews && title ? { title: clip(title, 60) } : {}),
        ...(project ? { project: clip(project, 40) } : {}),
        ...(workers > 0 ? { workers } : {}),
        hostId: host.hostId,
        ...(live.length > 1 ? { host: host.name.split(".")[0] || "Computer" } : {}),
      };
      return { row, rank: rank(lead)!, at: Math.max(0, ...active.map((session) => session.activityAt ?? 0)) };
    }),
  );
  ranked.sort((left, right) => left.rank - right.rank || right.at - left.at || (left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0));
  const rows = ranked.slice(0, MAX_ROWS).map((entry) => entry.row);
  const first = rows[0];
  const seconds = now / 1000;
  return {
    title: ranked.length === 1 ? (first?.title ?? "Telar work") : `${ranked.length} active sessions`,
    status: first?.status ?? "Working",
    updatedAt: seconds,
    startedAt: seconds,
    ended: false,
    ...(first ? { sessionId: first.id } : {}),
    activeCount: ranked.length,
    rows,
    ...(first?.hostId ? { hostId: first.hostId } : {}),
  };
}
