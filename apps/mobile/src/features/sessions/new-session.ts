import type { EnvMode, LiveSessionsAnswer, ProviderDriverKind, RuntimeMode } from "@telar/engine-client";
import { sessionModelSelection, type ModelChoice } from "@telar/client/providers";
import type { HostRegistry } from "../../platform/connection";

type Project = LiveSessionsAnswer["projects"][number];

/** A project on one computer: choosing it chooses the computer too. */
export type Target = { hostId: string; hostName: string; project: Project };
export type TargetSection = { title?: string; targets: Target[] };
export type Workspace = { envMode: EnvMode; branchName: string; /** The ref a new worktree starts from; absent is the checkout's HEAD. */ baseRef?: string };

const RECENT_LIMIT = 5;
const TITLE_LIMIT = 80;

export const targetKey = (hostId: string, projectId: string) => `${hostId}:${projectId}`;
const keyOf = (target: Target) => targetKey(target.hostId, target.project.id);
const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Every computer's projects, each computer's sorted by name. */
export function projectTargets(computers: readonly Computer[]): Target[] {
  return computers.flatMap(({ hostId, name, answer }) => [...(answer?.projects ?? [])].sort(byName).map((project) => ({ hostId, hostName: name, project })));
}

/** When each project last had a session move. */
export function projectActivity(computers: readonly Computer[]): Map<string, number> {
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

type Computer = { hostId: string; name: string; answer?: LiveSessionsAnswer | undefined; failed?: string | undefined };

/** Every paired computer's projects at once; one that did not answer is named, and never hides the others. */
export function targetState(computers: readonly Computer[]) {
  return {
    targets: projectTargets(computers),
    activity: projectActivity(computers),
    loading: computers.every((computer) => !computer.answer && !computer.failed),
    unreachable: computers.filter((computer) => !computer.answer && computer.failed).map((computer) => computer.name),
    computers: computers.length,
  };
}

/** The last one used first, then the most recently active, five at most. */
function recentTargets(targets: readonly Target[], activity: ReadonlyMap<string, number>, lastUsed: string | undefined): Target[] {
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

export const shortRef = (ref: string) => ref.replace(/^origin\//, "");

export function workspaceLabel({ envMode, branchName, baseRef }: Workspace): string {
  if (envMode !== "worktree") return "Current checkout";
  if (branchName) return `New worktree · ${branchName}`;
  return baseRef ? `New worktree · ${shortRef(baseRef)}` : "New worktree";
}

/** The first message, whitespace collapsed and cut to 80 characters; with no text, what was attached. */
export function sessionTitle(prompt: string, imageNames: readonly string[] = []): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (!flat) return imageNames.length === 1 ? imageNames[0]! : imageNames.length > 1 ? `${imageNames.length} images` : "";
  return flat.length > TITLE_LIMIT ? `${flat.slice(0, TITLE_LIMIT - 1)}…` : flat;
}

function createBody(draft: NewSession) {
  const { workspace } = draft;
  const worktree = workspace.envMode === "worktree";
  const branchName = worktree ? workspace.branchName.trim() : "";
  const images = (draft.files ?? []).filter((file) => file.mediaType.startsWith("image/")).map((file) => file.name);
  return {
    title: sessionTitle(draft.prompt, images),
    driver: draft.driver,
    envMode: workspace.envMode,
    ...(worktree && workspace.baseRef ? { baseRef: workspace.baseRef } : {}),
    ...(branchName ? { branchName } : {}),
  };
}

type AttachedFile = { name: string; mediaType: string; read: () => Promise<Uint8Array> };

export type NewSession = {
  projectId: string;
  workspace: Workspace;
  driver: ProviderDriverKind;
  /** Set only when the person changed the model; otherwise the engine's default stands. */
  choice?: ModelChoice;
  runtimeMode?: RuntimeMode;
  prompt: string;
  files?: readonly AttachedFile[];
  runId: string;
};

/**
 * Creates the session on the target's own computer, applies the chosen model and access, then sends the first message.
 * `created` is the session a failed earlier try already made, so a retry never makes a second one.
 */
export async function startSession(registry: Pick<HostRegistry, "get">, hostId: string, draft: NewSession, created: string | undefined, onCreated: (sessionId: string) => void): Promise<string> {
  const host = registry.get(hostId);
  if (!host) throw new Error("That computer is no longer paired.");
  let sessionId = created;
  if (!sessionId) {
    const { session } = await host.request<{ session: { id: string; providerInstanceId: string } }>("POST", `/v2/projects/${encodeURIComponent(draft.projectId)}/sessions`, createBody(draft));
    sessionId = session.id;
    onCreated(sessionId);
    const model = draft.choice && sessionModelSelection(session.providerInstanceId, draft.choice);
    if (model || draft.runtimeMode) {
      const patch = { ...(model ? { model } : {}), ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}) };
      await host.call(false, () => host.client.updateSession(session.id, patch)).catch(() => undefined);
    }
  }
  const id = sessionId;
  const attachments: string[] = [];
  for (const file of draft.files ?? []) {
    try {
      const data = await file.read();
      const { attachment } = await host.call(false, () => host.client.uploadAttachment(id, { name: file.name, mediaType: file.mediaType, data }));
      attachments.push(attachment.id);
    } catch {
      throw new Error(`Couldn't upload ${file.name} — nothing was sent. Try again.`);
    }
  }
  await host.call(false, () => host.client.submitTurn(id, { runId: draft.runId, input: draft.prompt, ...(attachments.length ? { attachments } : {}) }));
  return sessionId;
}

/** Where the person lands once the first message is in: the new session, in place of the form. */
export function createdRoute(hostId: string, sessionId: string, prompt: string) {
  return { name: "Session" as const, params: { hostId, sessionId, title: sessionTitle(prompt) || undefined } };
}

type Ref = { name: string; kind: "local" | "remote"; head?: boolean };
type Git = { branch?: string; defaultBase?: string; refs?: Ref[] } | undefined;
export type BranchRow = { value: string | undefined; label: string; badge?: string; mono: boolean };

const BRANCH_LIMIT = 40;

/** The Start from list: HEAD, the default and current branches, then Local and Origin, 40 each; a search lists every match. */
export function branchRows(git: Git, query: string): { pinned: BranchRow[]; local: BranchRow[]; origin: BranchRow[] } {
  const refs = git?.refs ?? [];
  const needle = query.trim().toLowerCase();
  const short = (ref: Ref) => (ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name);
  const pinned = new Set([git?.defaultBase, git?.branch].filter(Boolean));
  const localNames = new Set(refs.filter((ref) => ref.kind === "local").map((ref) => ref.name));
  const visible = needle ? refs.filter((ref) => ref.name.toLowerCase().includes(needle)) : refs.filter((ref) => !pinned.has(ref.name) && !(ref.kind === "remote" && localNames.has(short(ref))));
  const rows = (kind: Ref["kind"]) =>
    visible
      .filter((ref) => ref.kind === kind)
      .slice(0, BRANCH_LIMIT)
      .map((ref) => ({ value: ref.name, label: ref.name, mono: true, ...(kind === "remote" ? { badge: "remote" } : ref.head ? { badge: "current" } : {}) }));
  return {
    pinned: needle
      ? []
      : [
          { value: undefined, label: "Current HEAD", mono: false },
          ...(git?.defaultBase ? [{ value: git.defaultBase, label: git.defaultBase, badge: "default", mono: true }] : []),
          ...(git?.branch && git.branch !== git.defaultBase ? [{ value: git.branch, label: git.branch, badge: "current", mono: true }] : []),
        ],
    local: rows("local"),
    origin: rows("remote"),
  };
}
