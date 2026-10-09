import { parentKeyOf } from "../rail/flat-rail";
import { showsUnreadMark } from "../rail/unread";
import { sessionKey, type SessionBand, type SidebarSession } from "../session-list";

export type NeedsYou = { kind: "waiting" | "unread"; session: SidebarSession };

const RANK = { waiting: 0, unread: 1 } as const;
const MAX_PILLS = 4;

function kindOf(session: SidebarSession): NeedsYou["kind"] | null {
  if (session.activity === "blocked") return "waiting";
  return showsUnreadMark(session, false) ? "unread" : null;
}

export function needsYou(sessions: readonly SidebarSession[], bandFor: (session: SidebarSession) => SessionBand, attachedKey?: string): NeedsYou[] {
  const found: NeedsYou[] = [];
  for (const session of sessions) {
    if (session.archived || parentKeyOf(session) !== undefined || sessionKey(session) === attachedKey) continue;
    const band = bandFor(session);
    if (band !== "active" && band !== "pinned") continue;
    const kind = kindOf(session);
    if (kind) found.push({ kind, session });
  }
  return found.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.session.updatedAt - a.session.updatedAt).slice(0, MAX_PILLS);
}
