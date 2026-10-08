import { describe, expect, test } from "bun:test";
import { readTerminalTab, splitLegacyTerminalParams, terminalTabParams, withTerminalId, withTitle, type TerminalTab } from "./tab";

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

describe("splitLegacyTerminalParams", () => {
  test("a saved strip of three becomes three tabs, the run included", () => {
    const shells = JSON.stringify({
      shells: [
        { id: "shell", terminalId: "pty_1", title: "zsh" },
        { id: "shell#2", terminalId: "pty_2" },
        { id: "run", terminalId: "term_3", title: "web dev", run: { runId: "run_3", configId: "cfg_web" } },
      ],
      active: "shell#2",
    });
    expect(splitLegacyTerminalParams({ shells }).map(readTerminalTab)).toEqual([
      { terminalId: "pty_1", title: "zsh" },
      { terminalId: "pty_2" },
      { terminalId: "term_3", title: "web dev", run: { runId: "run_3", configId: "cfg_web" } },
    ]);
  });

  test("params that are not a saved strip pass through as one tab", () => {
    expect(splitLegacyTerminalParams({ terminal: "pty_1", title: "zsh" })).toEqual([{ terminal: "pty_1", title: "zsh" }]);
  });

  test("an unreadable or empty strip becomes one empty tab", () => {
    expect(splitLegacyTerminalParams({ shells: "not json" })).toEqual([{}]);
    expect(splitLegacyTerminalParams({ shells: JSON.stringify({ shells: [] }) })).toEqual([{}]);
  });
});
