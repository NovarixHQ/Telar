import type { BrowserSnapshot, EngineEvent, Item, Task, TaskState } from "@telar/engine-client";
import type { JournalTask } from "@/platform/engine";
import { browserPanelTab, browserTabId, type BrowserState } from "./model";
import { activePanelTab, closePanelTab, findPanelTab, revealPanelTab, type PanelTabInstance, type PanelTabState } from "./tabs";

/** Path → how many times the journal says this session wrote it. Keyed as the tool wrote it, usually absolute. */
export function journalWrites(items: readonly Item[]): Map<string, number> {
  const writes = new Map<string, number>();
  for (const item of items) {
    if (item.detail.type !== "file_change") continue;
    if (item.status === "declined" || item.status === "failed") continue;
    const path = item.detail.change.path;
    writes.set(path, (writes.get(path) ?? 0) + 1);
  }
  return writes;
}

export type BrowserStartState = { status: "idle" } | { status: "pending" } | { status: "error"; message: string };

export function describeBrowserStart(snapshot: Pick<BrowserSnapshot, "tabs" | "error" | "running">): BrowserStartState {
  if (snapshot.error) return { status: "error", message: snapshot.error };
  if (snapshot.tabs.length === 0) {
    return { status: "error", message: snapshot.running ? "The browser started but opened no page." : "The browser did not start." };
  }
  return { status: "idle" };
}

/** `browser.state.changed` carries the whole tab set, so folding it is a replace. */
export function latestBrowserState(events: readonly EngineEvent[]): BrowserState | undefined {
  let state: BrowserState | undefined;
  for (const event of events) {
    if (event.type === "browser.state.changed") state = { provider: event.provider, tabs: event.tabs };
  }
  return state;
}

export type NativePages = { tabs: readonly { id: string; active?: boolean }[]; ended?: boolean; popped?: boolean };

/**
 * Mirror the session's native browser pages as panel tabs: a new page is added unselected, a closed one loses its tab,
 * and a change of the native active page since `lastActive` is followed while a page tab is in front.
 * Adds nothing while the browser is in its own window. Returns the same object when nothing changes.
 */
export function syncPageTabs<Kind extends string>(state: PanelTabState<Kind>, native: NativePages, lastActive?: string): PanelTabState<Kind> {
  const pages = native.ended ? [] : native.tabs;
  let next = state;
  if (!native.popped) for (const page of pages) next = revealPanelTab(next, pageTab<Kind>(page.id));
  const active = pages.find((page) => page.active)?.id;
  const front = activePanelTab(next);
  const follow = active !== undefined && active !== lastActive && front !== undefined && browserTabId(front.kind) !== undefined && front.id !== browserPanelTab(active);
  if (follow && findPanelTab(next, browserPanelTab(active))) next = { ...next, activeTab: browserPanelTab(active) };
  const open = new Set(pages.map((page) => page.id));
  for (const tab of next.tabs) {
    const id = browserTabId(tab.kind);
    if (id !== undefined && !open.has(id)) next = closePanelTab(next, tab.id);
  }
  return next;
}

function pageTab<Kind extends string>(id: string): PanelTabInstance<Kind> {
  const kind = browserPanelTab(id) as Kind;
  return { id: kind, kind, params: {} };
}

/** The nonce makes a repeat press on the same chip a new request. */
export type TaskFocus = { id: string; nonce: number };

const LIVE_TASK_STATES = new Set<TaskState>(["pending", "running", "waiting"]);

export function isLiveTask(task: Task): boolean {
  return LIVE_TASK_STATES.has(task.state);
}

type RosterSplit = { agents: JournalTask[]; processes: JournalTask[] };

/** Anything the engine did not mark `background` is presumed an agent. */
export function splitRoster(tasks: readonly JournalTask[]): RosterSplit {
  return {
    agents: tasks.filter((task) => task.kind !== "background"),
    processes: tasks.filter((task) => task.kind === "background"),
  };
}

export type TabBadge = { count: number; running: number; failed: number };

/** The count an Agents or Processes tab wears, or nothing for every other kind. */
export function tabBadge(kind: string, roster: RosterSplit): TabBadge | undefined {
  const side = kind === "agents" ? roster.agents : kind === "processes" ? roster.processes : undefined;
  if (!side?.length) return undefined;
  return { count: side.length, running: side.filter(isLiveTask).length, failed: side.filter((task) => task.state === "failed").length };
}
