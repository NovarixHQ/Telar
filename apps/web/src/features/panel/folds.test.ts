import { describe, expect, test } from "bun:test";
import type { EngineEvent, Item } from "@telar/engine-client";
import { describeBrowserStart, journalWrites, latestBrowserState, syncPageTabs } from "./folds";
import type { PanelTabState } from "./tabs";

function fileChange(overrides: {
  path: string;
  at: number;
  status?: Item["status"];
  kind?: "create" | "edit" | "delete" | "rename";
  linesAdded?: number;
}): Item {
  return {
    id: `item_${overrides.path}_${overrides.at}`,
    sessionId: "session_1",
    runId: "run_1",
    status: overrides.status ?? "completed",
    startedAt: overrides.at,
    completedAt: overrides.at,
    detail: {
      type: "file_change",
      change: {
        path: overrides.path,
        kind: overrides.kind ?? "edit",
        ...(overrides.linesAdded === undefined ? {} : { linesAdded: overrides.linesAdded }),
      },
    },
  } as Item;
}

describe("journalWrites", () => {
  test("counts every write per path, whatever order they arrive in", () => {
    // The count is the one fact git cannot state: a file rewritten twice has the
    // same net diff as a file written once, and the Diff surface badges it `×2`.
    const writes = journalWrites([
      fileChange({ path: "a.ts", at: 200, linesAdded: 9 }),
      fileChange({ path: "a.ts", at: 100, linesAdded: 1 }),
      fileChange({ path: "b.ts", at: 150 }),
    ]);
    expect([...writes]).toEqual([
      ["a.ts", 2],
      ["b.ts", 1],
    ]);
  });

  test("omits changes that never landed", () => {
    // Counting a declined or failed change would claim the session edited a file
    // it did not — and on the Diff surface that would move the row from "not in
    // the transcript" to "the session wrote this", which is the most damaging
    // kind of wrong this fold can be.
    expect(journalWrites([fileChange({ path: "a.ts", at: 1, status: "declined" })]).size).toBe(0);
    expect(journalWrites([fileChange({ path: "b.ts", at: 1, status: "failed" })]).size).toBe(0);
  });
});

describe("latestBrowserState", () => {
  test("replaces rather than merges, because the event carries the whole tab set", () => {
    const events = [
      { type: "browser.state.changed", provider: "headless", tabs: [{ id: "1" }, { id: "2" }] },
      { type: "browser.state.changed", provider: "headless", tabs: [{ id: "3" }] },
    ] as unknown as EngineEvent[];
    expect(latestBrowserState(events)?.tabs.map((tab) => tab.id)).toEqual(["3"]);
  });

  test("is undefined when the session has never browsed", () => {
    expect(latestBrowserState([])).toBeUndefined();
  });
});

describe("syncPageTabs", () => {
  type Strip = PanelTabState<string>;
  const tab = (kind: string) => ({ id: kind, kind, params: {} });
  const page = (id: string, active = false) => ({ id, active });
  const ids = (state: Strip) => state.tabs.map((entry) => entry.id);

  test("a page the agent opened is shown when asked; one the person opened is only added", () => {
    const state: Strip = { tabs: [tab("diff")], activeTab: "diff", open: false };
    const agent = syncPageTabs(state, { tabs: [{ id: "a", openedBy: "agent" as const }] }, undefined, true);
    expect(agent.activeTab).toBe("browser:a");
    expect(agent.open).toBe(true);
    const human = syncPageTabs(state, { tabs: [{ id: "b", openedBy: "human" as const }] }, undefined, true);
    expect(human.activeTab).toBe("diff");
    const quiet = syncPageTabs(state, { tabs: [{ id: "a", openedBy: "agent" as const }] }, undefined, false);
    expect(quiet.activeTab).toBe("diff");
  });

  test("a new page gets a tab, unselected, and the panel stays as it was", () => {
    const state: Strip = { tabs: [tab("diff")], activeTab: "diff", open: false };
    const next = syncPageTabs(state, { tabs: [page("a", true)] }, "a");
    expect(ids(next)).toEqual(["diff", "browser:a"]);
    expect(next.activeTab).toBe("diff");
    expect(next.open).toBe(false);
  });

  test("a change of the native active page is followed while a page tab is in front", () => {
    const state: Strip = { tabs: [tab("browser:a")], activeTab: "browser:a", open: true };
    const next = syncPageTabs(state, { tabs: [page("a"), page("b", true)] }, "a");
    expect(ids(next)).toEqual(["browser:a", "browser:b"]);
    expect(next.activeTab).toBe("browser:b");
  });

  test("but not while another surface is in front, nor when the active page did not change", () => {
    const onDiff: Strip = { tabs: [tab("diff"), tab("browser:a")], activeTab: "diff", open: true };
    expect(syncPageTabs(onDiff, { tabs: [page("a"), page("b", true)] }, "a").activeTab).toBe("diff");
    const onA: Strip = { tabs: [tab("browser:a"), tab("browser:b")], activeTab: "browser:a", open: true };
    expect(syncPageTabs(onA, { tabs: [page("a"), page("b", true)] }, "b")).toBe(onA);
  });

  test("a page that closed loses its tab", () => {
    const state: Strip = { tabs: [tab("diff"), tab("browser:a"), tab("browser:b")], activeTab: "diff", open: true };
    expect(ids(syncPageTabs(state, { tabs: [page("b", true)] }, "b"))).toEqual(["diff", "browser:b"]);
  });

  test("an ended browser closes every page tab", () => {
    const state: Strip = { tabs: [tab("browser:a"), tab("diff"), tab("browser:b")], activeTab: "browser:a", open: true };
    const next = syncPageTabs(state, { tabs: [], ended: true });
    expect(ids(next)).toEqual(["diff"]);
    expect(next.activeTab).toBe("diff");
  });

  test("nothing is added while the browser is in its own window", () => {
    const state: Strip = { tabs: [tab("diff")], activeTab: "diff", open: true };
    expect(syncPageTabs(state, { tabs: [page("a", true)], popped: true })).toBe(state);
  });

  test("two pages make two tabs, and a page back from its own window returns as its own tab", () => {
    const state: Strip = { tabs: [tab("diff")], activeTab: "diff", open: true };
    const two = syncPageTabs(state, { tabs: [page("a"), page("b", true)] }, "b");
    expect(ids(two)).toEqual(["diff", "browser:a", "browser:b"]);
    const popped = syncPageTabs(two, { tabs: [page("a")], popped: true }, "b");
    expect(ids(popped)).toEqual(["diff", "browser:a"]);
    const back = syncPageTabs(popped, { tabs: [page("a"), page("b", true)] }, "a");
    expect(ids(back)).toEqual(["diff", "browser:a", "browser:b"]);
  });

  test("returns the same object when nothing changes", () => {
    const state: Strip = { tabs: [tab("diff"), tab("browser:a")], activeTab: "diff", open: true };
    expect(syncPageTabs(state, { tabs: [page("a", true)] }, "a")).toBe(state);
  });
});

describe("describeBrowserStart", () => {
  test("a tab means the press worked and the button goes quiet", () => {
    expect(describeBrowserStart({ running: true, tabs: [{ id: "0", url: "about:blank", title: "", active: true }] })).toEqual({ status: "idle" });
  });

  test("the engine's error is the message, verbatim", () => {
    expect(describeBrowserStart({ running: true, tabs: [], error: "Tab limit reached." })).toEqual({ status: "error", message: "Tab limit reached." });
  });

  test("running with no tab is named, not left looking like 'still starting'", () => {
    expect(describeBrowserStart({ running: true, tabs: [] })).toEqual({ status: "error", message: "The browser started but opened no page." });
    expect(describeBrowserStart({ running: false, tabs: [] })).toEqual({ status: "error", message: "The browser did not start." });
  });
});
