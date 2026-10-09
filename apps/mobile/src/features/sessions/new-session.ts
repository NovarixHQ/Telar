import type { EnvMode, LiveSessionsAnswer, ProviderDriverKind, RuntimeMode } from "@telar/engine-client";
import { sessionModelSelection, type ModelChoice } from "@telar/client/providers";
import type { HostConnection } from "../../platform/connection";

type Project = LiveSessionsAnswer["projects"][number];

/** A project on one computer: choosing it chooses the computer too. */
export type Target = { hostId: string; hostName: string; project: Project };
export type TargetSection = { title?: string; targets: Target[] };
export type Workspace = { envMode: EnvMode; branchName: string };

const RECENT_LIMIT = 5;
const TITLE_LIMIT = 80;

export const targetKey = (hostId: string, projectId: string) => `${hostId}:${projectId}`;
const keyOf = (target: Target) => targetKey(target.hostId, target.project.id);
const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Every computer's projects, each computer's sorted by name. */
export function projectTargets(computers: { hostId: string; name: string; answer: LiveSessionsAnswer | undefined }[]): Target[] {
  return computers.flatMap(({ hostId, name, answer }) => [...(answer?.projects ?? [])].sort(byName).map((project) => ({ hostId, hostName: name, project })));
}

/** When each project last had a session move. */
export function projectActivity(computers: { hostId: string; answer: LiveSessionsAnswer | undefined }[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const { hostId, answer } of computers) {
    for (const session of answer?.sessions ?? []) {
      if (!session.projectId) continue;
      const key = targetKey(hostId, session.projectId);
      latest.set(key, Math.max(latest.get(key) ?? 0, session.updatedAt));
    }
  }
  return latest;
}

/** The last one used first, then the most recently active, five at most. */
export function recentTargets(targets: readonly Target[], activity: ReadonlyMap<string, number>, lastUsed: string | undefined): Target[] {
  const ranked = targets.filter((target) => activity.has(keyOf(target))).sort((a, b) => activity.get(keyOf(b))! - activity.get(keyOf(a))!);
  const last = targets.find((target) => keyOf(target) === lastUsed);
  return [...(last ? [last] : []), ...ranked.filter((target) => keyOf(target) !== lastUsed)].slice(0, RECENT_LIMIT);
}

export function preferredTarget(targets: readonly Target[], activity: ReadonlyMap<string, number>, lastUsed: string | undefined): Target | undefined {
  return recentTargets(targets, activity, lastUsed)[0] ?? targets[0];
}

function matches(target: Target, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || [target.project.name, target.hostName, target.project.root].some((field) => field.toLowerCase().includes(needle));
}

/** The picker's sections: Recent, then each computer's projects when there are several, else All projects. */
export function pickerSections(targets: readonly Target[], activity: ReadonlyMap<string, number>, lastUsed: string | undefined, query = ""): TargetSection[] {
  const shown = targets.filter((target) => matches(target, query));
  const recents = recentTargets(shown, activity, lastUsed);
  const recentKeys = new Set(recents.map(keyOf));
  const rest = shown.filter((target) => !recentKeys.has(keyOf(target)));
  const sections: TargetSection[] = recents.length ? [{ title: "Recent", targets: recents }] : [];
  if (new Set(targets.map((target) => target.hostId)).size > 1) {
    const order = [...new Set(rest.map((target) => target.hostId))];
    for (const hostId of order) {
      const rows = rest.filter((target) => target.hostId === hostId);
      sections.push({ title: rows[0]!.hostName, targets: rows });
    }
  } else if (rest.length) {
    sections.push({ ...(recents.length ? { title: "All projects" } : {}), targets: rest });
  }
  return sections;
}

/** Two projects with one name tell themselves apart by their folder. */
export function showsPath(target: Target, targets: readonly Target[]): boolean {
  return targets.some((other) => keyOf(other) !== keyOf(target) && other.project.name.toLowerCase() === target.project.name.toLowerCase());
}

export function workspaceLabel({ envMode, branchName }: Workspace): string {
  if (envMode !== "worktree") return "Current checkout";
  return branchName ? `New worktree · ${branchName}` : "New worktree";
}

/** The first message, whitespace collapsed and cut to 80 characters. */
export function sessionTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_LIMIT ? `${flat.slice(0, TITLE_LIMIT - 1)}…` : flat;
}

export function createBody(workspace: Workspace, driver: ProviderDriverKind, prompt: string) {
  const branchName = workspace.envMode === "worktree" ? workspace.branchName.trim() : "";
  return { title: sessionTitle(prompt), driver, envMode: workspace.envMode, ...(branchName ? { branchName } : {}) };
}

export type NewSession = {
  projectId: string;
  workspace: Workspace;
  driver: ProviderDriverKind;
  /** Set only when the person changed the model; otherwise the engine's default stands. */
  choice?: ModelChoice;
  runtimeMode?: RuntimeMode;
  prompt: string;
  runId: string;
};

/**
 * Creates the session, applies the chosen model and access, then sends the first message.
 * `created` is the session a failed earlier try already made, so a retry never makes a second one.
 */
export async function startSession(host: HostConnection, draft: NewSession, created: string | undefined, onCreated: (sessionId: string) => void): Promise<string> {
  let sessionId = created;
  if (!sessionId) {
    const { session } = await host.request<{ session: { id: string; providerInstanceId: string } }>("POST", `/v2/projects/${encodeURIComponent(draft.projectId)}/sessions`, createBody(draft.workspace, draft.driver, draft.prompt));
    sessionId = session.id;
    onCreated(sessionId);
    const model = draft.choice && sessionModelSelection(session.providerInstanceId, draft.choice);
    if (model || draft.runtimeMode) {
      const patch = { ...(model ? { model } : {}), ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}) };
      await host.call(false, () => host.client.updateSession(session.id, patch)).catch(() => undefined);
    }
  }
  const id = sessionId;
  await host.call(false, () => host.client.submitTurn(id, { runId: draft.runId, input: draft.prompt }));
  return sessionId;
}

/** Where the person lands once the first message is in: the new session, in place of the form. */
export function createdRoute(hostId: string, sessionId: string, prompt: string) {
  return { name: "Session" as const, params: { hostId, sessionId, title: sessionTitle(prompt) } };
}
