import { describe, expect, test } from "bun:test";
import type { PanelTabInstance, PanelTabState } from "@/features/panel";
import { arrangeTerminalTabs, foldTerminalTabs, readTerminalTab, terminalTabParams, unfoldTerminalTabs, withTerminalId, withTitle, type TerminalTab } from "./tab";
import { readWorkspace, workspaceParams } from "./workspace";

describe("terminal tab params", () => {
  test("a shell and a run survive the round trip", () => {
    const tabs: TerminalTab[] = [{}, { terminalId: "pty_1", title: "zsh" }, { terminalId: "term_2", title: "web dev", run: { runId: "run_2", configId: "cfg_web" } }];
    for (const tab of tabs) expect(readTerminalTab(terminalTabParams(tab))).toEqual(tab);
  });

  test("a run saved without a configuration reads back with an empty one", () => {
    expect(readTerminalTab({ run: "run_1" })).toEqual({ run: { runId: "run_1", configId: "" } });
  });

  test("withTitle trims, and an empty title clears it", () => {
    expect(withTitle({ terminalId: "pty_1" }, "  vim  ")).toEqual({ terminalId: "pty_1", title: "vim" });
    expect(withTitle({ terminalId: "pty_1", title: "vim" }, "  ")).toEqual({ terminalId: "pty_1" });
  });

  test("withTerminalId keeps everything else", () => {
    expect(withTerminalId({ title: "zsh" }, "pty_2")).toEqual({ title: "zsh", terminalId: "pty_2" });
  });
});

const diff: PanelTabInstance<string> = { id: "diff", kind: "diff", params: {} };
const flatTab = (id: string, tab: TerminalTab): PanelTabInstance<string> => ({ id, kind: "terminal", params: terminalTabParams(tab) });
const zsh: TerminalTab = { terminalId: "pty_1", title: "zsh" };
const bare: TerminalTab = { terminalId: "pty_2" };
const web: TerminalTab = { terminalId: "term_3", title: "web dev", run: { runId: "run_3", configId: "cfg_web" } };
const flatStrip = (activeTab: string): PanelTabState<string> => ({
  tabs: [flatTab("terminal", zsh), diff, flatTab("terminal#2", bare), flatTab("terminal#3", web)],
  activeTab,
  open: true,
});
const strip = (state: PanelTabState<string>) => readWorkspace(state.tabs.find((tab) => tab.kind === "terminal")!.params);
const shells = (state: PanelTabState<string>) => strip(state).shells.map((shell) => readTerminalTab(terminalTabParams(shell)));
const flatShells = (state: PanelTabState<string>) => state.tabs.filter((tab) => tab.kind === "terminal").map((tab) => readTerminalTab(tab.params));

describe("foldTerminalTabs", () => {
  test("every Terminal tab becomes one chip of one tab at the first one's place, in order, nothing lost", () => {
    const folded = foldTerminalTabs(flatStrip("diff"), "terminal");
    expect(folded.tabs.map((tab) => tab.id)).toEqual(["terminal", "diff"]);
    expect(shells(folded)).toEqual([zsh, bare, web]);
    expect(folded.activeTab).toBe("diff");
    expect(strip(folded).active).toBe(strip(folded).shells[0]!.id);
  });

  test("the active Terminal tab becomes the active chip, and the folded tab is selected", () => {
    const folded = foldTerminalTabs(flatStrip("terminal#3"), "terminal");
    expect(folded.activeTab).toBe("terminal");
    const workspace = strip(folded);
    expect(workspace.shells.find((shell) => shell.id === workspace.active)?.run?.runId).toBe("run_3");
  });

  test("a panel already grouped, or with one fresh Terminal, is left as it was", () => {
    const folded = foldTerminalTabs(flatStrip("diff"), "terminal");
    expect(foldTerminalTabs(folded, "terminal")).toBe(folded);
    const fresh: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: {} }], activeTab: "terminal", open: true };
    expect(foldTerminalTabs(fresh, "terminal")).toBe(fresh);
  });
});

describe("unfoldTerminalTabs", () => {
  test("a strip of three becomes three tabs in its place, the active chip's tab selected", () => {
    const workspace = workspaceParams({ shells: [{ id: "shell", ...zsh }, { id: "shell#2", ...bare }, { id: "run", ...web }], active: "shell#2" });
    const state: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: workspace }, diff], activeTab: "terminal", open: true };
    const unfolded = unfoldTerminalTabs(state, "terminal");
    expect(unfolded.tabs.map((tab) => tab.id)).toEqual(["terminal", "terminal#2", "terminal#3", "diff"]);
    expect(flatShells(unfolded)).toEqual([zsh, bare, web]);
    expect(unfolded.activeTab).toBe("terminal#2");
  });

  test("an unreadable strip becomes one fresh Terminal, and flat tabs are left as they were", () => {
    const broken: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: { shells: "not json" } }], open: false };
    expect(unfoldTerminalTabs(broken, "terminal").tabs).toEqual([{ id: "terminal", kind: "terminal", params: {} }]);
    const flat = flatStrip("diff");
    expect(unfoldTerminalTabs(flat, "terminal")).toBe(flat);
  });
});

describe("arrangeTerminalTabs", () => {
  test("flat to grouped and back keeps every shell and run, their order and the active one", () => {
    for (const active of ["terminal", "terminal#2", "terminal#3", "diff"]) {
      const flat = flatStrip(active);
      const grouped = arrangeTerminalTabs(flat, "terminal", false);
      const back = arrangeTerminalTabs(grouped, "terminal", true);
      expect(flatShells(back)).toEqual([zsh, bare, web]);
      expect(back.tabs.map((tab) => tab.kind)).toEqual(["terminal", "terminal", "terminal", "diff"]);
      const activeShell = active === "diff" ? undefined : readTerminalTab(flat.tabs.find((tab) => tab.id === active)!.params);
      expect(activeShell ? readTerminalTab(back.tabs.find((tab) => tab.id === back.activeTab)!.params) : back.activeTab).toEqual(activeShell ?? "diff");
      expect(arrangeTerminalTabs(back, "terminal", false).tabs).toEqual(grouped.tabs);
    }
  });
});
