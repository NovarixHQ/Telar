/**
 * What the menu offers for `@` (the workspace listing), `/` (this composer's controls, then the
 * provider's commands) and `$` (the provider's skills). A completion is either text or an action.
 */

import type { ProviderDriverKind, ProviderSkill, ProviderSkillSource } from "@telar/engine-client";
import { fileReference, directoryReference, sessionReference, skillReference } from "@telar/client/composer";
import { insertRankedSearchResult, normalizeSearchQuery, scoreQueryMatch, type RankedSearchResult } from "@/ui/search-ranking";

export type CompletionGlyph = "file" | "directory" | "access" | "model" | "effort" | "driver" | "env" | "stop" | "compact" | "resume" | "skill" | "session" | "plugin";

type CompletionAction =
  /** Replace the trigger with this text; the only action that touches the draft. */
  | { type: "insert"; text: string }
  | { type: "picker"; picker: ComposerPicker }
  | { type: "env-mode"; mode: "local" | "worktree" }
  | { type: "driver"; driver: ProviderDriverKind }
  | { type: "compact" }
  | { type: "resume" }
  | { type: "stop" };

export type ComposerPicker = "model" | "effort" | "access";

export type Completion = {
  id: string;
  label: string;
  detail: string;
  glyph: CompletionGlyph;
  action: CompletionAction;
  path?: string;
  /** A section heading, drawn above the first row that carries it (see `ComposerMenu`). */
  group?: string;
  /** Listed but not pickable; the detail says why. */
  disabled?: boolean;
};

export type PathEntry = { path: string; name: string; parent: string; directory: boolean };

/**
 * The flat listing plus every directory implied by it (the engine sends files only).
 * Build once per listing, not per keystroke.
 */
export function buildPathIndex(files: readonly string[]): PathEntry[] {
  const directories = new Set<string>();
  const entries: PathEntry[] = [];
  for (const path of files) {
    const cut = path.lastIndexOf("/");
    entries.push({ path, name: cut === -1 ? path : path.slice(cut + 1), parent: cut === -1 ? "" : path.slice(0, cut), directory: false });
    for (let at = path.indexOf("/"); at !== -1; at = path.indexOf("/", at + 1)) directories.add(path.slice(0, at));
  }
  for (const directory of directories) {
    const cut = directory.lastIndexOf("/");
    entries.push({
      path: `${directory}/`,
      name: cut === -1 ? directory : directory.slice(cut + 1),
      parent: cut === -1 ? "" : directory.slice(0, cut),
      directory: true,
    });
  }
  return entries;
}

/** The trailing slash is not depth, so `apps/` sits level with `README.md`. */
function depthOf(path: string): number {
  return path.replace(/\/+$/, "").split("/").length;
}

function shallowestFirst(left: PathEntry, right: PathEntry): number {
  const depth = depthOf(left.path) - depthOf(right.path);
  if (depth !== 0) return depth;
  if (left.directory !== right.directory) return left.directory ? -1 : 1;
  return left.path.localeCompare(right.path);
}

function completionForPath(entry: PathEntry): Completion {
  // The same constructors a Files-panel drag uses, so typed and dragged text is identical.
  const reference = entry.directory ? directoryReference(entry.path) : fileReference(entry.path);
  return {
    id: `path:${entry.path}`,
    label: reference.label,
    detail: entry.parent,
    glyph: entry.directory ? "directory" : "file",
    action: { type: "insert", text: reference.text },
    path: entry.path,
  };
}

/** Tier, then how tight the match is within it; `null` when the entry does not match. */
function pathMatch(entry: PathEntry, query: string): { tier: number; closeness: number } | null {
  const name = entry.name.toLowerCase();
  const path = `/${entry.path.toLowerCase().replace(/\/$/, "")}`;
  if (name === query || name.split(".")[0] === query) return { tier: 0, closeness: 0 };
  if (name.startsWith(query)) return { tier: 1, closeness: 0 };
  if (path.includes(`/${query}`)) return { tier: 2, closeness: 0 };
  const inside = name.indexOf(query);
  if (inside !== -1) return { tier: 3, closeness: inside };
  if (path.includes(query)) return { tier: 4, closeness: 0 };
  // Fuzzy is basename-only: a subsequence matches nearly any path in a large repo.
  const fuzzy = scoreQueryMatch({ value: name, query, exactBase: 0, fuzzyBase: 0 });
  return fuzzy === null ? null : { tier: 5, closeness: fuzzy };
}

/** Exact basename, basename prefix, path segment prefix, substring, then fuzzy; a shorter path breaks ties. */
export function rankPaths(index: readonly PathEntry[], query: string, limit = 12): Completion[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [...index].sort(shallowestFirst).slice(0, limit).map(completionForPath);

  const ranked: RankedSearchResult<PathEntry>[] = [];
  for (const entry of index) {
    const match = pathMatch(entry, normalized);
    if (!match) continue;
    const score = match.tier * 1e8 + Math.min(match.closeness, 9999) * 1e4 + entry.path.length;
    // On a tie a file outranks its containing directory.
    insertRankedSearchResult(ranked, { item: entry, score, tieBreaker: `${entry.directory ? 1 : 0}\0${entry.path}` }, limit);
  }
  return ranked.map((entry) => completionForPath(entry.item));
}

export type SessionCandidate = { id: string; title: string; projectId?: string; projectName?: string; updatedAt: number };

/** The current project's sessions first, then the most recent; never the session being typed in. */
export function rankSessions(
  sessions: readonly SessionCandidate[],
  query: string,
  here: { sessionId?: string; projectId?: string },
  limit = 4,
): Completion[] {
  const normalized = normalizeSearchQuery(query);
  const ranked: RankedSearchResult<SessionCandidate>[] = [];
  for (const session of sessions) {
    if (session.id === here.sessionId) continue;
    const score = normalized
      ? scoreQueryMatch({ value: session.title.toLowerCase(), query: normalized, exactBase: 0, prefixBase: 2, boundaryBase: 8, includesBase: 16, fuzzyBase: 100, boundaryMarkers: [" ", "-", "_", "."] })
      : 0;
    if (score === null) continue;
    const elsewhere = here.projectId && session.projectId === here.projectId ? 0 : 1;
    const age = String(Number.MAX_SAFE_INTEGER - session.updatedAt).padStart(16, "0");
    insertRankedSearchResult(ranked, { item: session, score: score + elsewhere * 1000, tieBreaker: age }, limit);
  }
  return ranked.map(({ item }) => {
    const reference = sessionReference(item);
    return {
      id: `session:${item.id}`,
      label: reference.label,
      detail: item.projectName ?? "",
      glyph: "session",
      action: { type: "insert", text: reference.text },
      group: "Sessions",
    };
  });
}

type CommandContext = {
  busy: boolean;
  fresh: boolean;
  /** The pills on show; each one's picker gets a `/` row. */
  pickers?: Partial<Record<ComposerPicker, boolean>>;
  /** The agent that will receive the next message: the session's, or the canvas's before it exists. */
  driver?: ProviderDriverKind;
  /** Only ever true on an existing session; see `compactBlockedReason`. */
  compacting?: boolean;
  envMode?: "local" | "worktree";
  /** `onAdopt` is set and no session exists yet; mirrors the picker link's `fresh && onAdopt` gate. */
  canResume?: boolean;
  /** The engine reported Telar's bundled `orchestrate` skill for this session. */
  orchestrate?: boolean;
};

/** Mirrors the engine's `ORCHESTRATE_SKILL_NAME`. */
export const ORCHESTRATE_SKILL = "orchestrate";

/** Names the skill in prose, since only Claude's harness parses slash commands. */
export const ORCHESTRATE_PROMPT = `Use ${skillReference({ name: ORCHESTRATE_SKILL }).text} to coordinate this list:`;

/** `/compact` sent alone is the wheel's button; with an argument it stays a message. */
export function isCompactDraft(draft: string): boolean {
  return draft.trim() === "/compact";
}

export function isResumeDraft(draft: string): boolean {
  return draft.trim() === "/resume";
}

/** Why compacting is unavailable, or undefined. Shared with the usage wheel. */
export function compactBlockedReason(state: { busy: boolean; compacting?: boolean }): string | undefined {
  if (state.compacting) return "Already compacting.";
  if (state.busy) return "A turn is running.";
  return undefined;
}

/**
 * Commands that would do nothing are not offered (`/stop` needs a running turn, `/worktree`
 * a session not yet created). The one already in effect is listed and marked "(current)".
 */
export function availableCommands(context: CommandContext): Completion[] {
  const commands: Completion[] = [];

  if (context.pickers?.model) {
    commands.push({ id: "model", label: "/model", detail: "Switch the model for this session.", glyph: "model", action: { type: "picker", picker: "model" } });
  }
  if (context.pickers?.access) {
    commands.push({ id: "access", label: "/access", detail: "Choose what the agent may do without asking.", glyph: "access", action: { type: "picker", picker: "access" } });
  }

  if (context.pickers?.effort) {
    commands.push({ id: "effort", label: "/effort", detail: "How hard the model thinks before it answers.", glyph: "effort", action: { type: "picker", picker: "effort" } });
  }

  if (context.fresh) {
    for (const driver of ["claude", "codex"] as const) {
      commands.push({
        id: `driver:${driver}`,
        label: `/${driver}`,
        detail: context.driver === driver ? "Start this session on this agent. (current)" : "Start this session on this agent.",
        glyph: "driver",
        action: { type: "driver", driver },
      });
    }
    for (const mode of ["local", "worktree"] as const) {
      commands.push({
        id: `env:${mode}`,
        label: `/${mode}`,
        detail:
          mode === "worktree"
            ? "Work in a cut-off checkout of its own."
            : "Work directly in the project folder.",
        glyph: "env",
        action: { type: "env-mode", mode },
      });
    }
  }

  // `/compact`: Claude only, once the session exists. Absent rather than disabled otherwise,
   // since neither state recovers by waiting.
  if (!context.fresh && context.driver === "claude") {
    const blocked = compactBlockedReason(context);
    commands.push({
      id: "compact",
      label: "/compact",
      detail: blocked ?? "Summarise the session to free space.",
      glyph: "compact",
      action: { type: "compact" },
      ...(blocked ? { disabled: true } : {}),
    });
  }

  // `/resume`: only where the empty composer's link shows.
  if (context.fresh && context.canResume) {
    commands.push({
      id: "resume",
      label: "/resume",
      detail: "Pick up a Claude Code conversation.",
      glyph: "resume",
      action: { type: "resume" },
    });
  }

  // `/orchestrate`: only where the skill is installed.
  if (context.orchestrate) {
    commands.push({
      id: "orchestrate",
      label: "/orchestrate",
      detail: "Split a list of tasks across worker sessions and coordinate them.",
      glyph: "skill",
      action: { type: "insert", text: ORCHESTRATE_PROMPT },
    });
  }

  if (context.busy) {
    commands.push({ id: "stop", label: "/stop", detail: "Stop the turn that is running.", glyph: "stop", action: { type: "stop" } });
  }

  return commands;
}

/**
 * The fuzzy tier makes initials work (`fa` → `full-access`) and sits above every other tier.
 * The description is searchable but its bases start above every name tier, so it cannot win.
 */
export function rankCommands(commands: readonly Completion[], query: string): Completion[] {
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalized) return [...commands];

  const ranked: RankedSearchResult<Completion>[] = [];
  for (const command of commands) {
    const scores = [
      scoreQueryMatch({
        value: command.label.replace(/^\//, "").toLowerCase(),
        query: normalized,
        exactBase: 0,
        prefixBase: 2,
        boundaryBase: 6,
        includesBase: 12,
        fuzzyBase: 100,
        boundaryMarkers: ["-", " ", "_"],
      }),
      scoreQueryMatch({ value: command.detail.toLowerCase(), query: normalized, exactBase: 40, includesBase: 44 }),
    ].filter((score): score is number => score !== null);
    if (scores.length === 0) continue;
    insertRankedSearchResult(ranked, { item: command, score: Math.min(...scores), tieBreaker: command.label }, Number.POSITIVE_INFINITY);
  }
  return ranked.map((entry) => entry.item);
}

const SOURCE_LABEL: Record<ProviderSkillSource, string> = {
  project: "This project",
  user: "This computer",
  plugin: "Plugin",
  provider: "Provider",
};

function detailFor(entry: ProviderSkill): string {
  // An empty muted column reads as a broken row, so fall back to the source.
  return entry.description || SOURCE_LABEL[entry.source];
}

/** Picking it inserts `the "name" skill`; see `skillReference`. */
function completionForSkill(skill: ProviderSkill): Completion {
  return {
    id: `skill:${skill.name}`,
    label: skill.name,
    detail: detailFor(skill),
    glyph: "skill",
    action: { type: "insert", text: skillReference(skill).text },
  };
}

/**
 * Scored on name and description; the description cannot outrank a name. A namespace
 * is a boundary, so `vd` reaches `vercel:deploy`.
 */
export function rankSkills(skills: readonly ProviderSkill[], query: string, limit = 12): Completion[] {
  const normalized = normalizeSearchQuery(query, { trimLeadingPattern: /^\$+/ });
  if (!normalized) return skills.slice(0, limit).map(completionForSkill);

  const ranked: RankedSearchResult<ProviderSkill>[] = [];
  for (const skill of skills) {
    const scores = [
      scoreQueryMatch({
        value: skill.name.toLowerCase(),
        query: normalized,
        exactBase: 0,
        prefixBase: 2,
        boundaryBase: 6,
        includesBase: 12,
        fuzzyBase: 100,
        boundaryMarkers: [":", "-", "_", "."],
      }),
      scoreQueryMatch({ value: skill.description.toLowerCase(), query: normalized, exactBase: 40, includesBase: 44 }),
    ].filter((score): score is number => score !== null);
    if (scores.length === 0) continue;
    insertRankedSearchResult(ranked, { item: skill, score: Math.min(...scores), tieBreaker: skill.name }, limit);
  }
  return ranked.map((entry) => completionForSkill(entry.item));
}

export const PROVIDER_COMMAND_GROUP = "Provider commands";

export const TELAR_COMMAND_NAMES: ReadonlySet<string> = new Set(
  [
    ...availableCommands({ busy: true, fresh: true, pickers: { model: true, effort: true, access: true }, canResume: true, orchestrate: true }),
    ...availableCommands({ busy: false, fresh: false, driver: "claude" }),
  ].map((command) => command.label.slice(1)),
);

/** Picking one inserts `/name`, which the harness parses when the message arrives. Names Telar or a plugin owns are skipped. */
export function providerCommandCompletions(commands: readonly ProviderSkill[], taken: ReadonlySet<string> = TELAR_COMMAND_NAMES): Completion[] {
  return commands.filter((command) => !taken.has(command.name)).map((command) => ({
    id: `provider:${command.name}`,
    label: `/${command.name}`,
    detail: detailFor(command),
    glyph: "skill",
    group: PROVIDER_COMMAND_GROUP,
    action: { type: "insert", text: `/${command.name}` },
  }));
}
