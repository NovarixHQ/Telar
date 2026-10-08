import { nextPanelTabId, type PanelTabInstance, type PanelTabState } from "@/features/panel";
import { emptyWorkspace, isWorkspaceParams, nextShellId, readWorkspace, workspaceParams } from "./workspace";

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

function shellsOf(params: Params): { shells: TerminalTab[]; active: number } {
  if (!isWorkspaceParams(params)) return { shells: [readTerminalTab(params)], active: 0 };
  const workspace = readWorkspace(params);
  return { shells: workspace.shells, active: workspace.shells.findIndex((shell) => shell.id === workspace.active) };
}

/** Every Terminal tab into one at the first one's place, keeping each shell and run, their order and the active one. */
export function foldTerminalTabs<Kind extends string>(state: PanelTabState<Kind>, kind: Kind): PanelTabState<Kind> {
  const held = state.tabs.filter((tab) => tab.kind === kind);
  const first = held[0];
  if (!first || (held.length === 1 && (isWorkspaceParams(first.params) || Object.keys(first.params).length === 0))) return state;
  let workspace = emptyWorkspace();
  let active: string | undefined;
  for (const tab of held) {
    const each = shellsOf(tab.params);
    each.shells.forEach((shell, index) => {
      const id = nextShellId(workspace);
      workspace = { shells: [...workspace.shells, { ...terminalShell(shell), id }] };
      if (tab.id === state.activeTab && index === each.active) active = id;
    });
  }
  const folded = { id: first.id, kind, params: workspaceParams({ ...workspace, active: active ?? workspace.shells[0]?.id }) };
  const tabs = state.tabs.flatMap((tab) => (tab === first ? [folded] : tab.kind === kind ? [] : [tab]));
  const activeTab = held.some((tab) => tab.id === state.activeTab) ? first.id : state.activeTab;
  return { ...state, tabs, ...(activeTab ? { activeTab } : {}) };
}

/** Every shell and run of a grouped Terminal tab into its own tab, in strip order; the active shell's tab is active. */
export function unfoldTerminalTabs<Kind extends string>(state: PanelTabState<Kind>, kind: Kind): PanelTabState<Kind> {
  if (!state.tabs.some((tab) => tab.kind === kind && isWorkspaceParams(tab.params))) return state;
  const tabs: PanelTabInstance<Kind>[] = [];
  let activeTab = state.activeTab;
  for (const tab of state.tabs) {
    if (tab.kind !== kind || !isWorkspaceParams(tab.params)) {
      tabs.push(tab);
      continue;
    }
    const { shells, active } = shellsOf(tab.params);
    if (shells.length === 0) tabs.push({ ...tab, params: {} });
    shells.forEach((shell, index) => {
      const id = index === 0 ? tab.id : nextPanelTabId({ tabs: [...tabs, ...state.tabs], open: false }, kind);
      tabs.push({ id, kind, params: terminalTabParams(shell) });
      if (state.activeTab === tab.id && index === active) activeTab = id;
    });
  }
  return { ...state, tabs, ...(activeTab ? { activeTab } : {}) };
}

/** The Terminal tabs as the chosen model draws them: one per shell (`flat`), or one holding a strip. */
export function arrangeTerminalTabs<Kind extends string>(state: PanelTabState<Kind>, kind: Kind, flat: boolean): PanelTabState<Kind> {
  return flat ? unfoldTerminalTabs(state, kind) : foldTerminalTabs(state, kind);
}

function terminalShell(tab: TerminalTab): TerminalTab {
  return readTerminalTab(terminalTabParams(tab));
}
