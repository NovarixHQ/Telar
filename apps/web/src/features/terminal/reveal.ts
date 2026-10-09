import { closePanelTab, nextPanelTabId, revealPanelTab, setPanelTabParams, type PanelTabState } from "@/features/panel";
import { isOpenTerminal } from "./run/presentation";
import type { RunView } from "./run/types";
import { readTerminalTab, terminalTabParams, type TerminalTab } from "./tab";

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
