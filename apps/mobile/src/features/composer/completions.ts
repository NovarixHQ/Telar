import type { EnvMode, ProviderDriverKind, ProviderSkill, ProviderSkills, RuntimeMode } from "@telar/engine-client";
import { sessionReference, skillReference } from "@telar/client/composer";
import type { Trigger } from "./trigger";

export type CompletionAction =
  | { kind: "insert"; text: string }
  | { kind: "runtimeMode"; mode: RuntimeMode }
  | { kind: "driver"; driver: ProviderDriverKind }
  | { kind: "envMode"; mode: EnvMode }
  | { kind: "stop" };

export type Completion = { id: string; label: string; detail: string; symbol: string; group: string; action: CompletionAction };

export type MentionTarget = { sessionId: string; title: string; projectId?: string; projectName?: string };

export type CompletionContext = {
  busy: boolean;
  runtimeMode?: RuntimeMode;
  /** A session not made yet: it can still pick its agent and workspace. */
  fresh?: { driver: ProviderDriverKind; envMode: EnvMode };
  skills: ProviderSkills;
  targets: readonly MentionTarget[];
  current: { sessionId?: string; projectId?: string };
};

const ORCHESTRATE = "orchestrate";

const ACCESS: { slug: string; mode: RuntimeMode; detail: string }[] = [
  { slug: "supervised", mode: "approval-required", detail: "Ask before commands and file changes." },
  { slug: "auto-edits", mode: "auto-accept-edits", detail: "Auto-approve edits, ask before other actions." },
  { slug: "auto", mode: "auto", detail: "A reviewer approves routine actions; risky ones still ask." },
  { slug: "full-access", mode: "full-access", detail: "Allow commands and edits without prompts." },
];

const SOURCE_DETAIL: Record<string, string> = { project: "This project", user: "This computer", plugin: "Plugin" };

function detailOf(entry: ProviderSkill): string {
  return entry.description || SOURCE_DETAIL[entry.source] || "Provider";
}

function subsequence(value: string, query: string): number | undefined {
  let next = 0;
  let first = -1;
  let previous = -1;
  let gaps = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== query[next]) continue;
    if (first === -1) first = index;
    if (previous !== -1) gaps += index - previous - 1;
    previous = index;
    next += 1;
    if (next === query.length) return first * 2 + gaps * 3 + (index - first + 1 - query.length) + Math.min(64, value.length - query.length);
  }
  return undefined;
}

type Weights = { exact: number; prefix?: number; boundary?: number; includes?: number; fuzzy?: number; markers?: string[] };

/** Lower is better; undefined is no match. The same weights as the Swift app's completion list. */
function score(value: string, query: string, weights: Weights): number | undefined {
  if (!value || !query) return undefined;
  if (value === query) return weights.exact;
  const penalty = Math.min(64, Math.max(0, value.length - query.length));
  if (weights.prefix !== undefined && value.startsWith(query)) return weights.prefix + penalty;
  if (weights.boundary !== undefined) {
    const hits = (weights.markers ?? [" ", "-", "_", "/"]).map((marker) => value.indexOf(marker + query)).filter((at) => at >= 0);
    if (hits.length > 0) return weights.boundary + (Math.min(...hits) + 1) * 2 + penalty;
  }
  const at = value.indexOf(query);
  if (weights.includes !== undefined && at >= 0) return weights.includes + at * 2 + penalty;
  if (weights.fuzzy !== undefined) {
    const fuzzy = subsequence(value, query);
    if (fuzzy !== undefined) return weights.fuzzy + fuzzy;
  }
  return undefined;
}

function best(...scores: (number | undefined)[]): number | undefined {
  const found = scores.filter((value): value is number => value !== undefined);
  return found.length > 0 ? Math.min(...found) : undefined;
}

function rank<T>(items: readonly T[], limit: number, name: (item: T) => string, scored: (item: T) => number | undefined): T[] {
  return items
    .flatMap((item) => {
      const value = scored(item);
      return value === undefined ? [] : [{ item, value }];
    })
    .sort((left, right) => left.value - right.value || name(left.item).localeCompare(name(right.item)))
    .slice(0, limit)
    .map(({ item }) => item);
}

const normalize = (query: string, sigil: string) => query.trim().replace(new RegExp(`^\\${sigil}+`), "").toLowerCase();

function rankCommands(commands: Completion[], query: string): Completion[] {
  const wanted = normalize(query, "/");
  if (!wanted) return commands;
  return rank(commands, Infinity, (row) => row.label, (row) =>
    best(
      score(row.label.replace(/^\/+/, "").toLowerCase(), wanted, { exact: 0, prefix: 2, boundary: 6, includes: 12, fuzzy: 100, markers: ["-", " ", "_"] }),
      score(row.detail.toLowerCase(), wanted, { exact: 40, includes: 44 }),
    ),
  );
}

function rankSkills(skills: readonly ProviderSkill[], query: string, limit = 12): Completion[] {
  const wanted = normalize(query, "$");
  const picked = wanted
    ? rank(skills, limit, (skill) => skill.name, (skill) =>
        best(
          score(skill.name.toLowerCase(), wanted, { exact: 0, prefix: 2, boundary: 6, includes: 12, fuzzy: 100, markers: [":", "-", "_", "."] }),
          score(skill.description.toLowerCase(), wanted, { exact: 40, includes: 44 }),
        ),
      )
    : skills.slice(0, limit);
  return picked.map((skill) => ({ id: `skill:${skill.name}`, label: skill.name, detail: detailOf(skill), symbol: "sparkles", group: "Skills", action: { kind: "insert", text: skillReference(skill).text } }));
}

function rankSessions(context: CompletionContext, query: string, limit = 4): Completion[] {
  const wanted = normalize(query, "@");
  const scored = context.targets.flatMap((target, order) => {
    if (target.sessionId === context.current.sessionId) return [];
    const match = wanted ? score(target.title.toLowerCase(), wanted, { exact: 0, prefix: 2, boundary: 8, includes: 16, fuzzy: 100, markers: [" ", "-", "_", "."] }) : 0;
    if (match === undefined) return [];
    const elsewhere = context.current.projectId && target.projectId === context.current.projectId ? 0 : 1;
    return [{ target, value: match + elsewhere * 1000, order }];
  });
  return scored
    .sort((left, right) => left.value - right.value || left.order - right.order)
    .slice(0, limit)
    .map(({ target }) => ({
      id: `session:${target.sessionId}`,
      label: target.title || "Untitled",
      detail: target.projectName ?? "",
      symbol: "bubble.left.and.bubble.right",
      group: "Sessions",
      action: { kind: "insert", text: sessionReference({ id: target.sessionId, title: target.title }).text },
    }));
}

function ownCommands(context: CompletionContext): Completion[] {
  const command = (id: string, label: string, detail: string, symbol: string, action: CompletionAction): Completion => ({ id, label, detail, symbol, group: "Commands", action });
  const current = (detail: string, on: boolean) => (on ? `${detail} (current)` : detail);
  const rows = ACCESS.map((entry) => command(`access:${entry.mode}`, `/${entry.slug}`, current(entry.detail, context.runtimeMode === entry.mode), "slider.horizontal.3", { kind: "runtimeMode", mode: entry.mode }));
  const { fresh } = context;
  if (fresh) {
    for (const driver of ["claude", "codex"]) rows.push(command(`driver:${driver}`, `/${driver}`, current("Start this session on this agent.", fresh.driver === driver), "cpu", { kind: "driver", driver }));
    rows.push(command("env:local", "/local", current("Work directly in the project folder.", fresh.envMode === "local"), "folder", { kind: "envMode", mode: "local" }));
    rows.push(command("env:worktree", "/worktree", current("Work in a cut-off checkout of its own.", fresh.envMode === "worktree"), "arrow.triangle.branch", { kind: "envMode", mode: "worktree" }));
  }
  if (context.skills.skills.some((skill) => skill.name === ORCHESTRATE)) {
    const prompt = `Use ${skillReference({ name: ORCHESTRATE }).text} to coordinate this list:`;
    rows.push(command("orchestrate", "/orchestrate", "Split a list of tasks across worker sessions and coordinate them.", "sparkles", { kind: "insert", text: prompt }));
  }
  if (context.busy) rows.push(command("stop", "/stop", "Stop the turn that is running.", "stop.fill", { kind: "stop" }));
  return rows;
}

/** What the suggestion list offers for the trigger being typed, grouped in the order it draws them. */
export function completionsFor(trigger: Trigger, context: CompletionContext): Completion[] {
  if (trigger.kind === "mention") return rankSessions(context, trigger.query);
  const skills = rankSkills(context.skills.skills, trigger.query);
  if (trigger.kind === "skill") return skills;
  const provider = context.skills.commands.map((entry): Completion => ({
    id: `provider:${entry.name}`,
    label: `/${entry.name}`,
    detail: detailOf(entry),
    symbol: "terminal",
    group: "Provider commands",
    action: { kind: "insert", text: `/${entry.name}` },
  }));
  return [...rankCommands(ownCommands(context), trigger.query), ...rankCommands(provider, trigger.query), ...skills];
}
