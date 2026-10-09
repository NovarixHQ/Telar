import type { LiveSessionRow, Project } from "@telar/engine-client";
import { showsUnreadMark } from "../rail/unread";
import { toSidebarSession } from "../session-list";

export type NeedsYou = { kind: "waiting" | "unread" | "running"; session: LiveSessionRow; projectName: string };

const RANK = { waiting: 0, unread: 1, running: 2 } as const;
const MAX_PILLS = 6;

function kindOf(session: LiveSessionRow, projectName: string): NeedsYou["kind"] | null {
  if (session.activity === "blocked") return "waiting";
  if (showsUnreadMark(toSidebarSession(session, projectName), false)) return "unread";
  return session.activity === "working" ? "running" : null;
}

export function needsYou(sessions: readonly LiveSessionRow[], projects: readonly Project[], attachedId?: string): NeedsYou[] {
  const name = (projectId?: string) => projects.find((project) => project.id === projectId)?.name ?? projectId ?? "";
  const found: NeedsYou[] = [];
  for (const session of sessions) {
    if (session.id === attachedId || session.state !== "active") continue;
    const projectName = name(session.projectId);
    const kind = kindOf(session, projectName);
    if (kind) found.push({ kind, session, projectName });
  }
  return found.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.session.updatedAt - a.session.updatedAt).slice(0, MAX_PILLS);
}
