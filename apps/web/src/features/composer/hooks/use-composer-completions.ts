"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { ProviderDriverKind, ProviderSkills } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import {
  availableCommands,
  buildPathIndex,
  ORCHESTRATE_SKILL,
  providerCommandCompletions,
  rankCommands,
  TELAR_COMMAND_NAMES,
  rankPaths,
  rankProjects,
  rankSessions,
  rankSkills,
  type Completion,
  type ComposerPicker,
  type PathEntry,
  type ProjectCandidate,
  type SessionCandidate,
  settledCompletions,
  settledSearchRow,
} from "../completions";
import { useExperiment } from "@/features/settings/experiments";
import type { ComposerCommand } from "../decorations";
import { pluginCommandCompletions, writingPluginCommand } from "../plugin-commands";
import { detectComposerTrigger, type ComposerTrigger } from "../tokens";
import type { ComposerEditorHandle } from "../components/composer-editor";

const pageApi = createEngineApi();
type EngineApi = typeof pageApi;

const PATHS_FAILED: Completion = { id: "paths:failed", label: "Files", detail: "Could not read the files here.", glyph: "directory", action: { type: "insert", text: "" }, disabled: true };
const SETTLED_LIMIT = 20;
const NONE: Completion[] = [];
const SETTLED_FAILED: Completion = { id: "settled:failed", label: "Settled sessions", detail: "Could not search them.", glyph: "settled", action: { type: "insert", text: "" }, disabled: true };
const PATHS_READING: Completion = { id: "paths:reading", label: "Reading files…", detail: "", glyph: "directory", action: { type: "insert", text: "" }, disabled: true };

type CommandState = {
  busy: boolean;
  fresh: boolean;
  pickers: Record<ComposerPicker, boolean>;
  envMode: "local" | "worktree" | undefined;
  compacting: boolean | undefined;
  canResume: boolean;
};

/** Read on focus or the first sigil, never on mount: listing is a git call, skills may spawn the harness. A failure is read again once `retry` changes. */
function useLazyRead<T>(wanted: boolean, checkout: string, read: (() => Promise<T>) | undefined, fallback: T, retry?: unknown) {
  // Keyed by checkout so one session's answer never serves another.
  const [cache, setCache] = useState<{ checkout: string; value: T; failed?: { retry: unknown } }>();
  const [reading, setReading] = useState(false);
  if (cache?.failed && (!wanted || cache.failed.retry !== retry)) setCache(undefined);
  const value = cache?.checkout === checkout ? cache.value : undefined;
  useEffect(() => {
    if (!wanted || value || reading || !read) return;
    const task = window.setTimeout(() => {
      setReading(true);
      void read()
        .then((answer) => setCache({ checkout, value: answer }))
        .catch(() => setCache({ checkout, value: fallback, failed: { retry } }))
        .finally(() => setReading(false));
    }, 0);
    return () => window.clearTimeout(task);
    // `read` and `fallback` are rebuilt every render; `checkout` names what they read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, value, reading, checkout]);
  return { value, reading, failed: Boolean(value && cache?.failed) };
}

/** `@` for paths, `$` for skills, `/` for this box's commands then the provider's. */
export function useComposerCompletions({
  editor,
  hostId,
  sessionId,
  projectId,
  menuDriver,
  blocked,
  commands,
  pluginCommands,
  onOpen,
}: {
  editor: RefObject<ComposerEditorHandle | null>;
  hostId?: string | undefined;
  sessionId: string | undefined;
  projectId: string | undefined;
  menuDriver: ProviderDriverKind | undefined;
  /** A question is open: the editor holds an answer, and `@` in it is punctuation. */
  blocked: boolean;
  commands: CommandState;
  pluginCommands: readonly ComposerCommand[];
  onOpen?: ((open: boolean) => void) | undefined;
}) {
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [active, setActive] = useState(0);
  // Escape hides the list without clearing the trigger; the next edit re-arms it.
  const [dismissed, setDismissed] = useState(false);
  const api = useMemo(() => (hostId ? createEngineApi(hostFetcher(hostId)) : pageApi), [hostId]);
  const checkout = `${hostId ?? ""}:${sessionId ?? (projectId ? `project:${projectId}` : "none")}`;
  const [primed, setPrimed] = useState<string>();
  const wantPaths = trigger?.kind === "path" || primed === checkout;

  const listPaths = sessionId || projectId
    ? async () => buildPathIndex((sessionId ? await api.sessionFiles(sessionId) : await api.projectFiles(projectId!)).listing.files)
    : async () => [] as PathEntry[];
  const paths = useLazyRead(wantPaths, checkout, listPaths, [] as PathEntry[], trigger?.query);
  // The reading engine's sessions only: a reference to another host's session would not resolve there.
  const listSessions = async (): Promise<{ sessions: SessionCandidate[]; projects: ProjectCandidate[] }> => {
    const live = await api.liveSessions();
    const names = new Map(live.projects.map((project) => [project.id, project.name]));
    return {
      sessions: live.sessions.map(({ id, title, projectId, updatedAt }) => ({ id, title, projectId, updatedAt, projectName: projectId ? names.get(projectId) : undefined })),
      projects: live.projects.filter((project) => project.removedAt === undefined),
    };
  };
  const sessions = useLazyRead(wantPaths, checkout, listSessions, { sessions: [], projects: [] });
  const [citeProjects] = useExperiment(CITE_PROJECTS_EXPERIMENT);
  const settled = useSettledSearch(api, sessionId);
  const listSkills = sessionId ? () => api.sessionSkills(sessionId) : projectId ? () => api.projectSkills(projectId, menuDriver) : undefined;
  const skills = useLazyRead<ProviderSkills>(trigger?.kind === "skill" || trigger?.kind === "command", checkout, listSkills, { skills: [], commands: [] });

  const { busy, fresh, pickers: { model: modelPicker, effort: effortPicker, access: accessPicker }, envMode, compacting, canResume } = commands;
  const completions = useMemo<Completion[]>(() => {
    if (!trigger || dismissed) return [];
    if (settled.query !== undefined) return settled.failed ? [SETTLED_FAILED] : settled.completions;
    if (trigger.kind === "skill") return rankSkills(skills.value?.skills ?? [], trigger.query);
    if (trigger.kind === "path") {
      const sessionRows = rankSessions(sessions.value?.sessions ?? [], trigger.query, { sessionId, projectId });
      const files = paths.failed ? [PATHS_FAILED] : paths.value ? rankPaths(paths.value, trigger.query, 12) : [PATHS_READING];
      const projectRows = citeProjects ? rankProjects(sessions.value?.projects ?? [], trigger.query) : [];
      const search = settledSearchRow(trigger.query);
      return [...files, ...sessionRows, ...projectRows, ...(search ? [search] : [])];
    }
    if (writingPluginCommand(trigger.query, pluginCommands)) return [];
    // Ranked lists, not one: a plugin command must not outscore `/stop`.
    const own = availableCommands({
      busy,
      fresh,
      pickers: { model: modelPicker, effort: effortPicker, access: accessPicker },
      ...(menuDriver ? { driver: menuDriver } : {}),
      ...(compacting ? { compacting } : {}),
      ...(envMode ? { envMode } : {}),
      canResume,
      orchestrate: Boolean(skills.value?.skills.some((skill) => skill.name === ORCHESTRATE_SKILL)),
    });
    const plugins = pluginCommandCompletions(pluginCommands, TELAR_COMMAND_NAMES);
    const taken = new Set([...TELAR_COMMAND_NAMES, ...pluginCommands.map((command) => command.name)]);
    return [...rankCommands(own, trigger.query), ...rankCommands(plugins, trigger.query), ...rankCommands(providerCommandCompletions(skills.value?.commands ?? [], taken), trigger.query)];
  }, [trigger, dismissed, settled.query, settled.failed, settled.completions, citeProjects, paths.value, paths.failed, sessions.value, sessionId, projectId, skills.value, busy, fresh, modelPicker, effortPicker, accessPicker, menuDriver, compacting, envMode, canResume, pluginCommands]);

  // `@` always opens, so an empty or unreadable listing says so instead of looking like a dead key.
  const loading = settled.reading || (trigger?.kind === "path" && (paths.reading || sessions.reading)) || (trigger?.kind === "skill" && skills.reading);
  const open = !blocked && trigger !== null && !dismissed && (completions.length > 0 || loading || trigger.kind === "path");
  useEffect(() => onOpen?.(open), [onOpen, open]);

  /** Recompute from the live caret after every edit and caret move; leaving a `@word` closes the list. */
  const retrigger = useCallback(
    (text: string) => setTrigger(detectComposerTrigger(text, editor.current?.caret() ?? text.length)),
    [editor],
  );

  const edited = (text: string) => {
    settled.leave();
    retrigger(text);
    setActive(0);
    setDismissed(false);
  };

  /** Takes the trigger out of the draft (or swaps in the inserted text) and returns the picked action. */
  const take = (completion: Completion): Completion["action"] | undefined => {
    // A disabled row is a label: the list stays open so its reason stays on screen.
    if (completion.disabled) return undefined;
    if (completion.action.type === "search-settled") {
      settled.enter(completion.action.query);
      setActive(0);
      return undefined;
    }
    settled.leave();
    const range = trigger;
    setTrigger(null);
    setDismissed(false);
    setActive(0);
    const action = completion.action;
    if (range) editor.current?.replaceRange(range.rangeStart, range.rangeEnd, action.type === "insert" ? `${action.text} ` : "");
    return action;
  };

  const heading = () =>
    settled.query !== undefined ? "Settled sessions" : trigger?.kind === "skill" ? "Skills" : trigger?.kind === "command" ? "Commands" : "Files and folders";

  const prime = () => setPrimed(checkout);

  const back = () => {
    if (settled.query === undefined) return false;
    settled.leave();
    setActive(0);
    return true;
  };

  return { trigger, completions, open, loading, active, setActive, setDismissed, retrigger, edited, take, heading, prime, back };
}

export type ComposerCompletions = ReturnType<typeof useComposerCompletions>;

export const CITE_PROJECTS_EXPERIMENT = "cite-projects";

function useSettledSearch(api: EngineApi, sessionId: string | undefined) {
  const [query, setQuery] = useState<string>();
  const [answer, setAnswer] = useState<{ query: string; completions: Completion[]; failed?: boolean }>();
  useEffect(() => {
    if (query === undefined) return;
    let live = true;
    api.findSessions({ q: query, settled: true, limit: SETTLED_LIMIT })
      .then((found) => live && setAnswer({ query, completions: settledCompletions(found.sessions, { sessionId }) }))
      .catch(() => live && setAnswer({ query, completions: [], failed: true }));
    return () => {
      live = false;
    };
  }, [api, query, sessionId]);
  const current = query !== undefined && answer?.query === query ? answer : undefined;
  return {
    query,
    completions: current?.completions ?? NONE,
    failed: Boolean(current?.failed),
    reading: query !== undefined && !current,
    enter: setQuery,
    leave: () => setQuery(undefined),
  };
}
