import { describe, expect, test } from "bun:test";
import type { RunView } from "./run/types";
import type { PanelTabInstance, PanelTabState } from "@/features/panel";
import { openTerminal, revealTerminal, syncRunTabs } from "./reveal";
import { readTerminalTab, terminalTabParams } from "./tab";

const view = (over: Partial<RunView> = {}): RunView => ({
  terminalId: "term_1",
  runId: "run_1",
  projectId: "project_1",
  sessionId: "session_1",
  origin: "agent",
  title: "vite",
  configId: "cfg_web",
  configName: "vite",
  command: "bun run dev",
  worktreePath: "/fixtures/telar",
  cwd: "/fixtures/telar",
  status: "running",
  activity: "idle",
  readiness: { kind: "pending" },
  startedAt: 200,
  env: [],
  ...over,
});

const diff: PanelTabInstance<string> = { id: "diff", kind: "diff", params: {} };
const shellTab: PanelTabInstance<string> = { id: "terminal", kind: "terminal", params: terminalTabParams({ terminalId: "pty_1", title: "zsh" }) };
const tabOf = (state: PanelTabState<string>, id: string) => readTerminalTab(state.tabs.find((tab) => tab.id === id)?.params ?? {});

describe("revealTerminal", () => {
  test("a run gets its own tab, unselected, in every panel state", () => {
    const cases: PanelTabState<string>[] = [
      { tabs: [diff], activeTab: "diff", open: false },
      { tabs: [diff], activeTab: "diff", open: true },
      { tabs: [], open: true },
      { tabs: [], open: false },
    ];
    for (const state of cases) {
      const next = revealTerminal(state, view(), "terminal");
      expect(next.tabs.map((tab) => tab.id)).toEqual([...state.tabs.map((tab) => tab.id), "terminal"]);
      expect(next.activeTab).toBe(state.activeTab);
      expect(next.open).toBe(state.open);
      expect(tabOf(next, "terminal")).toEqual({ terminalId: "term_1", title: "vite", run: { runId: "run_1", configId: "cfg_web" } });
    }
  });

  test("a run that already has a tab leaves the state as it was", () => {
    const once = revealTerminal({ tabs: [diff], activeTab: "diff", open: false }, view(), "terminal");
    expect(revealTerminal(once, view({ title: "renamed" }), "terminal")).toBe(once);
  });

  test("two runs get two tabs", () => {
    const once = revealTerminal({ tabs: [], open: false }, view(), "terminal");
    const twice = revealTerminal(once, view({ terminalId: "term_2", runId: "run_2", title: "vite #2" }), "terminal");
    expect(twice.tabs.map((tab) => tab.id)).toEqual(["terminal", "terminal#2"]);
    expect(tabOf(twice, "terminal#2").run?.runId).toBe("run_2");
  });

  test("a shell tab is not mistaken for the run's", () => {
    const next = revealTerminal({ tabs: [shellTab], activeTab: "terminal", open: true }, view(), "terminal");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["terminal", "terminal#2"]);
    expect(next.activeTab).toBe("terminal");
  });
});

describe("syncRunTabs", () => {
  const withRun = (run = view()) => revealTerminal({ tabs: [diff, shellTab], activeTab: "diff", open: true }, run, "terminal");

  test("a run's tab follows the feed's title and terminal", () => {
    const next = syncRunTabs(withRun(), [view({ title: "web", terminalId: "term_9" })], "terminal");
    expect(tabOf(next, "terminal#2")).toEqual({ terminalId: "term_9", title: "web", run: { runId: "run_1", configId: "cfg_web" } });
  });

  test("a run that ended loses its tab", () => {
    const next = syncRunTabs(withRun(), [view({ status: "closed", closedBy: "person" })], "terminal");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["diff", "terminal"]);
  });

  test("a run the engine no longer lists is closed only on the first read", () => {
    const state = withRun();
    expect(syncRunTabs(state, [], "terminal")).toBe(state);
    expect(syncRunTabs(state, [], "terminal", { dropMissing: true }).tabs.map((tab) => tab.id)).toEqual(["diff", "terminal"]);
  });

  test("shell tabs are left alone, even with dropMissing", () => {
    const state: PanelTabState<string> = { tabs: [diff, shellTab], activeTab: "terminal", open: true };
    expect(syncRunTabs(state, [], "terminal", { dropMissing: true })).toBe(state);
  });

  test("a feed that changes nothing returns the same state", () => {
    const state = withRun();
    expect(syncRunTabs(state, [view()], "terminal")).toBe(state);
  });
});

describe("openTerminal", () => {
  test("a row in the Workspace card selects that run's tab and opens the panel", () => {
    const state: PanelTabState<string> = { tabs: [diff], activeTab: "diff", open: false };
    const other = revealTerminal(state, view({ terminalId: "a", runId: "a" }), "terminal");
    const next = openTerminal(other, view({ terminalId: "b", runId: "b" }), "terminal");
    expect(next.open).toBe(true);
    expect(tabOf(next, next.activeTab!).run?.runId).toBe("b");
    expect(openTerminal(next, view({ terminalId: "a", runId: "a" }), "terminal").tabs).toHaveLength(3);
  });
});
