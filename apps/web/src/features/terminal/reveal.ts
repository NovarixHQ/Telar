import { closePanelTab, nextPanelTabId, revealPanelTab, setPanelTabParams, type PanelTabState } from "@/features/panel";
import { isOpenTerminal } from "./run/presentation";
import type { RunView } from "./run/types";
import { readTerminalTab, terminalTabParams, type TerminalTab } from "./tab";
import { dropEndedRuns, readWorkspace, upsertRunShell, workspaceParams } from "./workspace";

/** A run as its tab stores it. The terminal id is kept only while the terminal is open: the pane attaches to it. */
function runTab(run: RunView): TerminalTab & { run: { runId: string; configId: string } } {
  return {
    ...(isOpenTerminal(run) ? { terminalId: run.terminalId } : {}),
    ...(run.title ? { title: run.title } : {}),
    run: { runId: run.runId, configId: run.configId ?? "" },
  };
}

function tabForRun<Kind extends string>(state: PanelTabState<Kind>, kind: Kind, runId: string) {
  return state.tabs.find((tab) => tab.kind === kind && readTerminalTab(tab.params).run?.runId === runId);
}

/** Gives a run its own tab; `show` also opens the panel on it. Same object when nothing changes. */
export function revealTerminal<Kind extends string>(state: PanelTabState<Kind>, run: RunView, kind: Kind, show = false): PanelTabState<Kind> {
  const held = tabForRun(state, kind, run.runId);
  return revealPanelTab(state, held ?? { id: nextPanelTabId(state, kind), kind, params: terminalTabParams(runTab(run)) }, show);
}

export function startedCommand(run: RunView, before: RunView | undefined): boolean {
  return run.activity === "busy" && (before === undefined || before.activity !== "busy" || before.command !== run.command);
}

/**
 * Keeps every run tab current with the feed and closes the tabs of runs that ended. `dropMissing` (the first read)
 * also closes tabs of runs the engine no longer lists. Same object when nothing changed.
 */
export function syncRunTabs<Kind extends string>(
  state: PanelTabState<Kind>,
  terminals: readonly RunView[],
  kind: Kind,
  { dropMissing = false }: { dropMissing?: boolean } = {},
): PanelTabState<Kind> {
  let next = state;
  for (const tab of state.tabs) {
    if (tab.kind !== kind) continue;
    const run = readTerminalTab(tab.params).run;
    if (!run) continue;
    const view = terminals.find((entry) => entry.runId === run.runId);
    const ended = view ? !isOpenTerminal(view) : dropMissing;
    if (ended) next = closePanelTab(next, tab.id);
    else if (view) next = setPanelTabParams(next, tab.id, terminalTabParams(runTab(view)));
  }
  return next;
}

/** Grouped: the run's chip joins the one Terminal tab; `show` also selects the chip and opens the panel on the tab. */
export function revealGroupedTerminal<Kind extends string>(state: PanelTabState<Kind>, run: RunView, kind: Kind, show = false): PanelTabState<Kind> {
  const held = state.tabs.find((tab) => tab.kind === kind);
  const workspace = readWorkspace(held?.params ?? {});
  const next = upsertRunShell(workspace, runTab(run), { focus: show });
  const id = held?.id ?? nextPanelTabId(state, kind);
  const params = next === workspace && held ? held.params : workspaceParams(next);
  return revealPanelTab(held ? setPanelTabParams(state, id, params) : state, { id, kind, params }, show);
}

/** Grouped `syncRunTabs`: run chips follow the feed, ended ones go, and a strip left empty closes its tab. */
export function syncGroupedRuns<Kind extends string>(
  state: PanelTabState<Kind>,
  terminals: readonly RunView[],
  kind: Kind,
  { dropMissing = false }: { dropMissing?: boolean } = {},
): PanelTabState<Kind> {
  const view = (runId: string) => terminals.find((entry) => entry.runId === runId);
  let next = state;
  for (const tab of state.tabs) {
    if (tab.kind !== kind) continue;
    const workspace = readWorkspace(tab.params);
    let updated = dropEndedRuns(workspace, (runId) => (view(runId) ? isOpenTerminal(view(runId)) : undefined), { dropMissing });
    for (const shell of updated.shells) {
      const current = shell.run && view(shell.run.runId);
      if (current) updated = upsertRunShell(updated, runTab(current));
    }
    if (updated === workspace) continue;
    next = updated.shells.length === 0 ? closePanelTab(next, tab.id) : setPanelTabParams(next, tab.id, workspaceParams(updated));
  }
  return next;
}

/** A person asked for this run: its tab (or chip) is selected and the panel opens. */
export function openTerminal<Kind extends string>(state: PanelTabState<Kind>, run: RunView, kind: Kind, flat = true): PanelTabState<Kind> {
  return flat ? revealTerminal(state, run, kind, true) : revealGroupedTerminal(state, run, kind, true);
}
