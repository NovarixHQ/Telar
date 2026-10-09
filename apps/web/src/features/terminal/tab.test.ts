import { describe, expect, test } from "bun:test";
import type { PanelTabInstance, PanelTabState } from "@/features/panel";
import { readTerminalTab, terminalTabParams, unfoldTerminalTabs, withTerminalId, withTitle, type TerminalTab } from "./tab";

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
const zsh: TerminalTab = { terminalId: "pty_1", title: "zsh" };
const bare: TerminalTab = { terminalId: "pty_2" };
const web: TerminalTab = { terminalId: "term_3", title: "web dev", run: { runId: "run_3", configId: "cfg_web" } };
const shells = (state: PanelTabState<string>) => state.tabs.filter((tab) => tab.kind === "terminal").map((tab) => readTerminalTab(tab.params));

describe("unfoldTerminalTabs", () => {
  test("a saved strip of three becomes three tabs in its place, the active shell's tab selected", () => {
    const grouped = JSON.stringify({ shells: [{ id: "shell", ...zsh }, { id: "shell#2", ...bare }, { id: "run", ...web }], active: "shell#2" });
    const state: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: { shells: grouped } }, diff], activeTab: "terminal", open: true };
    const unfolded = unfoldTerminalTabs(state, "terminal");
    expect(unfolded.tabs.map((tab) => tab.id)).toEqual(["terminal", "terminal#2", "terminal#3", "diff"]);
    expect(shells(unfolded)).toEqual([zsh, bare, web]);
    expect(unfolded.activeTab).toBe("terminal#2");
  });

  test("an unreadable strip becomes one fresh Terminal, and one-shell tabs are left as they were", () => {
    const broken: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: { shells: "not json" } }], open: false };
    expect(unfoldTerminalTabs(broken, "terminal").tabs).toEqual([{ id: "terminal", kind: "terminal", params: {} }]);
    const plain: PanelTabState<string> = { tabs: [{ id: "terminal", kind: "terminal", params: terminalTabParams(zsh) }, diff], open: true };
    expect(unfoldTerminalTabs(plain, "terminal")).toBe(plain);
  });
});
