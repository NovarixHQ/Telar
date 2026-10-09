import { nextPanelTabId, type PanelTabInstance, type PanelTabState } from "@/features/panel";

/** One Terminal panel tab: a person's shell, or a run the engine owns. Persisted flat in the tab's params. */
export type TerminalTab = {
  /** The host's PTY id; absent while a shell is still opening. */
  terminalId?: string;
  /** What the shell called itself (OSC 0/2), or a run's configuration name. */
  title?: string;
  run?: { runId: string; configId: string };
};

type Params = Readonly<Record<string, string>>;

const TERMINAL_ID_PARAM = "terminal";
const TITLE_PARAM = "title";
const RUN_PARAM = "run";
const CONFIG_PARAM = "config";

export function readTerminalTab(params: Params): TerminalTab {
  const terminalId = params[TERMINAL_ID_PARAM];
  const title = params[TITLE_PARAM];
  const runId = params[RUN_PARAM];
  return {
    ...(terminalId ? { terminalId } : {}),
    ...(title ? { title } : {}),
    ...(runId ? { run: { runId, configId: params[CONFIG_PARAM] ?? "" } } : {}),
  };
}

export function terminalTabParams(tab: TerminalTab): Record<string, string> {
  return {
    ...(tab.terminalId ? { [TERMINAL_ID_PARAM]: tab.terminalId } : {}),
    ...(tab.title ? { [TITLE_PARAM]: tab.title } : {}),
    ...(tab.run ? { [RUN_PARAM]: tab.run.runId, [CONFIG_PARAM]: tab.run.configId } : {}),
  };
}

/** An empty title clears it, so the tab goes back to its default label. */
export function withTitle(tab: TerminalTab, title: string): TerminalTab {
  const wanted = title.trim();
  return { ...(tab.terminalId ? { terminalId: tab.terminalId } : {}), ...(wanted ? { title: wanted } : {}), ...(tab.run ? { run: tab.run } : {}) };
}

export function withTerminalId(tab: TerminalTab, terminalId: string): TerminalTab {
  return { ...tab, terminalId };
}

const GROUPED_PARAM = "shells";

/** A grouped tab's saved strip, read leniently: localStorage has held it across upgrades. */
function groupedShells(raw: string): { shells: TerminalTab[]; active: number } {
  try {
    const parsed = JSON.parse(raw) as { shells?: unknown; active?: unknown };
    const entries = Array.isArray(parsed?.shells) ? (parsed.shells as Record<string, unknown>[]) : [];
    const valid = entries.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string");
    const shells = valid.map((entry) => {
      const run = entry.run as { runId?: unknown; configId?: unknown } | undefined;
      return readTerminalTab({
        ...(typeof entry.terminalId === "string" ? { [TERMINAL_ID_PARAM]: entry.terminalId } : {}),
        ...(typeof entry.title === "string" ? { [TITLE_PARAM]: entry.title } : {}),
        ...(typeof run?.runId === "string" ? { [RUN_PARAM]: run.runId, [CONFIG_PARAM]: typeof run.configId === "string" ? run.configId : "" } : {}),
      });
    });
    return { shells, active: Math.max(valid.findIndex((entry) => entry.id === parsed.active), 0) };
  } catch {
    return { shells: [], active: 0 };
  }
}

/** Splits a Terminal tab saved by the grouped panel (removed 2026-10) into one tab per shell. Delete after 2027-01-09. */
export function unfoldTerminalTabs<Kind extends string>(state: PanelTabState<Kind>, kind: Kind): PanelTabState<Kind> {
  if (!state.tabs.some((tab) => tab.kind === kind && GROUPED_PARAM in tab.params)) return state;
  const tabs: PanelTabInstance<Kind>[] = [];
  let activeTab = state.activeTab;
  for (const tab of state.tabs) {
    const raw = tab.kind === kind ? tab.params[GROUPED_PARAM] : undefined;
    if (raw === undefined) {
      tabs.push(tab);
      continue;
    }
    const { shells, active } = groupedShells(raw);
    if (shells.length === 0) tabs.push({ ...tab, params: {} });
    shells.forEach((shell, index) => {
      const id = index === 0 ? tab.id : nextPanelTabId({ tabs: [...tabs, ...state.tabs], open: false }, kind);
      tabs.push({ id, kind, params: terminalTabParams(shell) });
      if (state.activeTab === tab.id && index === active) activeTab = id;
    });
  }
  return { ...state, tabs, ...(activeTab ? { activeTab } : {}) };
}
