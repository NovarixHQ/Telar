import type { TerminalTab } from "./tab";

type Params = Readonly<Record<string, string>>;

/** One chip in a grouped Terminal tab's strip. `id` is ours and outlives the PTY; `terminalId` is the host's. */
export type TerminalShell = TerminalTab & { id: string };

export type TerminalWorkspace = {
  shells: TerminalShell[];
  /** A shell id, not an index, so a close never moves focus to whatever slides into the slot. */
  active?: string;
};

export const TERMINAL_WORKSPACE_PARAM = "shells";

export function emptyWorkspace(): TerminalWorkspace {
  return { shells: [] };
}

function nextId(state: TerminalWorkspace, base: string): string {
  const taken = (id: string) => state.shells.some((shell) => shell.id === id);
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}#${n}`;
    if (!taken(id)) return id;
  }
}

export function nextShellId(state: TerminalWorkspace): string {
  return nextId(state, "shell");
}

/** A new shell at the end of the strip, focused. */
export function addShell(state: TerminalWorkspace, id: string = nextShellId(state)): TerminalWorkspace {
  if (state.shells.some((shell) => shell.id === id)) return { ...state, active: id };
  return { shells: [...state.shells, { id }], active: id };
}

/** Puts a run in the strip or updates its chip, matched by run id. Takes focus only with `focus`, or in an empty strip. */
export function upsertRunShell(state: TerminalWorkspace, run: TerminalTab & { run: { runId: string; configId: string } }, options: { focus?: boolean } = {}): TerminalWorkspace {
  const existing = state.shells.find((shell) => shell.run?.runId === run.run.runId);
  const shape = (id: string): TerminalShell => ({
    id,
    ...(run.terminalId ? { terminalId: run.terminalId } : {}),
    ...(run.title ? { title: run.title } : {}),
    run: run.run,
  });
  if (existing) {
    const next = shape(existing.id);
    const unchanged = existing.terminalId === next.terminalId && existing.title === next.title && existing.run?.configId === next.run?.configId;
    if (unchanged && (!options.focus || state.active === existing.id)) return state;
    return {
      ...state,
      shells: state.shells.map((shell) => (shell.id === existing.id ? next : shell)),
      ...(options.focus ? { active: existing.id } : {}),
    };
  }
  const id = nextId(state, "run");
  return { shells: [...state.shells, shape(id)], active: options.focus || state.active === undefined ? id : state.active };
}

/** The neighbour to the right (or the new last) takes focus; closing the last shell leaves an empty strip. */
export function closeShell(state: TerminalWorkspace, id: string): TerminalWorkspace {
  const index = state.shells.findIndex((shell) => shell.id === id);
  if (index === -1) return state;
  const shells = state.shells.filter((shell) => shell.id !== id);
  if (shells.length === 0) return { shells };
  const active = state.active === id ? (shells[index]?.id ?? shells[shells.length - 1]!.id) : state.active;
  return { shells, ...(active ? { active } : {}) };
}

export function activateShell(state: TerminalWorkspace, id: string): TerminalWorkspace {
  return state.shells.some((shell) => shell.id === id) && state.active !== id ? { ...state, active: id } : state;
}

export function setShellTerminal(state: TerminalWorkspace, id: string, terminalId: string): TerminalWorkspace {
  if (!state.shells.some((shell) => shell.id === id && shell.terminalId !== terminalId)) return state;
  return { ...state, shells: state.shells.map((shell) => (shell.id === id ? { ...shell, terminalId } : shell)) };
}

/** An empty title clears it, so the chip goes back to `Shell N`. */
export function setShellTitle(state: TerminalWorkspace, id: string, title: string): TerminalWorkspace {
  const wanted = title.trim();
  const current = state.shells.find((shell) => shell.id === id);
  if (!current || (current.title ?? "") === wanted) return state;
  return {
    ...state,
    shells: state.shells.map((shell) =>
      shell.id === id ? { id, ...(shell.terminalId ? { terminalId: shell.terminalId } : {}), ...(wanted ? { title: wanted } : {}), ...(shell.run ? { run: shell.run } : {}) } : shell,
    ),
  };
}

/** Drops the chips of runs that ended; with `dropMissing`, also those of runs the engine no longer lists. */
export function dropEndedRuns(state: TerminalWorkspace, isOpen: (runId: string) => boolean | undefined, { dropMissing = false } = {}): TerminalWorkspace {
  let next = state;
  for (const shell of state.shells) {
    if (!shell.run) continue;
    const open = isOpen(shell.run.runId);
    if (open === false || (open === undefined && dropMissing)) next = closeShell(next, shell.id);
  }
  return next;
}

/** The shell's own title, or `Shell N` counting shells only; a run without a title is `Run`. */
export function shellLabel(state: TerminalWorkspace, id: string): string {
  const shell = state.shells.find((entry) => entry.id === id);
  if (!shell) return "Shell";
  if (shell.title) return shell.title;
  if (shell.run) return "Run";
  return `Shell ${state.shells.filter((entry) => entry.run === undefined).findIndex((entry) => entry.id === id) + 1}`;
}

export function workspaceParams(state: TerminalWorkspace): Record<string, string> {
  if (state.shells.length === 0) return {};
  return { [TERMINAL_WORKSPACE_PARAM]: JSON.stringify(state) };
}

export function isWorkspaceParams(params: Params): boolean {
  return TERMINAL_WORKSPACE_PARAM in params;
}

/** Validated: this is JSON a localStorage has held across upgrades. */
export function readWorkspace(params: Params): TerminalWorkspace {
  const raw = params[TERMINAL_WORKSPACE_PARAM];
  if (!raw) return emptyWorkspace();
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = (parsed && typeof parsed === "object" ? parsed : {}) as { shells?: unknown; active?: unknown };
    const shells: TerminalShell[] = [];
    for (const entry of Array.isArray(record.shells) ? record.shells : []) {
      const shell = (entry && typeof entry === "object" ? entry : {}) as { id?: unknown; terminalId?: unknown; title?: unknown; run?: unknown };
      if (typeof shell.id !== "string" || !shell.id || shells.some((other) => other.id === shell.id)) continue;
      const run = runOf(shell.run);
      shells.push({
        id: shell.id,
        ...(typeof shell.terminalId === "string" && shell.terminalId ? { terminalId: shell.terminalId } : {}),
        ...(typeof shell.title === "string" && shell.title ? { title: shell.title } : {}),
        ...(run ? { run } : {}),
      });
    }
    if (shells.length === 0) return emptyWorkspace();
    return { shells, active: shells.some((shell) => shell.id === record.active) ? (record.active as string) : shells[0]!.id };
  } catch {
    return emptyWorkspace();
  }
}

/** A run is its run id; an empty `configId` is a run the agent opened without a recipe. */
function runOf(value: unknown): { runId: string; configId: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const run = value as { runId?: unknown; configId?: unknown };
  if (typeof run.runId !== "string" || !run.runId) return undefined;
  return { runId: run.runId, configId: typeof run.configId === "string" ? run.configId : "" };
}
