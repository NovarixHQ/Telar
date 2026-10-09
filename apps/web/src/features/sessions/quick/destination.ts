import type { SidebarSession } from "../session-list";
import type { QuickProject } from "./hosts";

export type Destination = { kind: "session"; session: SidebarSession } | { kind: "project"; project: QuickProject; envMode: "local" | "worktree" };

export type DestinationRow = { kind: "project"; project: QuickProject } | { kind: "session"; session: SidebarSession };

const MAX_SESSIONS = 8;

export function destinationQuery(text: string): string | null {
  return text.startsWith("#") ? text.slice(1) : null;
}

const live = (session: SidebarSession) => (session.activity === "working" || session.activity === "blocked" ? 0 : 1);

export function destinationRows(query: string, projects: readonly QuickProject[], sessions: readonly SidebarSession[], current?: QuickProject): DestinationRow[] {
  const needle = query.trim().toLowerCase();
  const fresh = needle ? projects.filter((project) => (project.name ?? project.id).toLowerCase().includes(needle)).slice(0, 2) : current ? [current] : [];
  const matching = sessions
    .filter((session) => !session.archived && (!needle || `${session.title} ${session.projectName ?? ""} ${session.hostName ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => live(a) - live(b) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  return [...fresh.map((project) => ({ kind: "project" as const, project })), ...matching.map((session) => ({ kind: "session" as const, session }))];
}
