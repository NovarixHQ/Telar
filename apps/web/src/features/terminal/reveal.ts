import { closePanelTab, nextPanelTabId, revealPanelTab, setPanelTabParams, type PanelTabState } from "@/features/panel";
import { isOpenTerminal } from "./run/presentation";
import type { RunView } from "./run/types";
import { readTerminalTab, terminalTabParams, type TerminalTab } from "./tab";

/** A run as its tab stores it. The terminal id is kept only while the terminal is open: the pane attaches to it. */
function runTab(run: RunView): TerminalTab {
  return {
    ...(isOpenTerminal(run) ? { terminalId: run.terminalId } : {}),
    ...(run.title ? { title: run.title } : {}),
    run: { runId: run.runId, configId: run.configId ?? "" },
  };
}

function tabForRun<Kind extends string>(state: PanelTabState<Kind>, kind: Kind, runId: string) {
  return state.tabs.find((tab) => tab.kind === kind && readTerminalTab(tab.params).run?.runId === runId);
}

/** Gives a run its own tab, unselected and with the panel untouched. Same object when it already has one. */
export function revealTerminal<Kind extends string>(state: PanelTabState<Kind>, run: RunView, kind: Kind): PanelTabState<Kind> {
  if (tabForRun(state, kind, run.runId)) return state;
  return revealPanelTab(state, { id: nextPanelTabId(state, kind), kind, params: terminalTabParams(runTab(run)) });
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

/** A person asked for this run: its tab is selected and the panel opens. */
export function openTerminal<Kind extends string>(state: PanelTabState<Kind>, run: RunView, kind: Kind): PanelTabState<Kind> {
  const revealed = revealTerminal(state, run, kind);
  return { ...revealed, activeTab: tabForRun(revealed, kind, run.runId)!.id, open: true };
}
