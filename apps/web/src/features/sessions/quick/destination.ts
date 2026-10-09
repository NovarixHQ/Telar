import type { LiveSessionRow, Project } from "@telar/engine-client";

export type Destination =
  | { kind: "session"; session: LiveSessionRow; projectName: string }
  | { kind: "project"; project: Project; envMode: "local" | "worktree" };

export type DestinationRow = { kind: "project"; project: Project } | { kind: "session"; session: LiveSessionRow; projectName: string };

const MAX_SESSIONS = 8;

export function destinationQuery(text: string): string | null {
  return text.startsWith("#") ? text.slice(1) : null;
}

const live = (session: LiveSessionRow) => (session.activity === "working" || session.activity === "blocked" ? 0 : 1);

export function destinationRows(query: string, projects: readonly Project[], sessions: readonly LiveSessionRow[], currentProjectId?: string): DestinationRow[] {
  const needle = query.trim().toLowerCase();
  const name = (projectId?: string) => projects.find((project) => project.id === projectId)?.name ?? projectId ?? "";
  const fresh = needle
    ? projects.filter((project) => (project.name ?? project.id).toLowerCase().includes(needle)).slice(0, 2)
    : projects.filter((project) => project.id === currentProjectId);
  const matching = sessions
    .filter((session) => session.state === "active" && (!needle || `${session.title} ${name(session.projectId)}`.toLowerCase().includes(needle)))
    .sort((a, b) => live(a) - live(b) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  return [
    ...fresh.map((project) => ({ kind: "project" as const, project })),
    ...matching.map((session) => ({ kind: "session" as const, session, projectName: name(session.projectId) })),
  ];
}
