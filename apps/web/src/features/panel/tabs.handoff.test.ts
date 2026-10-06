import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canvasPanelKey,
  clearPanelTabs,
  emptyPanelTabs,
  openPanelTab,
  readPanelTabs,
  writePanelTabs,
  type PanelTabState,
} from "./tabs";

type Tab = "run" | "changes" | "editor";
const isTab = (tab: string): tab is Tab => tab === "run" || tab === "changes" || tab === "editor";
const kinds = (state: PanelTabState<Tab>) => state.tabs.map((tab) => tab.kind);

let previous: unknown;

beforeEach(() => {
  const store = new Map<string, string>();
  previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = previous;
});

describe("per-key panels", () => {
  test("a new conversation starts with everything closed", () => {
    expect(readPanelTabs<Tab>(canvasPanelKey("project_1"), isTab)).toEqual(emptyPanelTabs<Tab>());
  });

  test("two sessions keep independent panels — closing one does not close the other", () => {
    writePanelTabs("session_a", openPanelTab(emptyPanelTabs<Tab>(), "run"), 1);
    writePanelTabs("session_b", openPanelTab(emptyPanelTabs<Tab>(), "changes"), 1);
    writePanelTabs("session_a", emptyPanelTabs<Tab>(), 2);
    expect(kinds(readPanelTabs<Tab>("session_a", isTab))).toEqual([]);
    expect(kinds(readPanelTabs<Tab>("session_b", isTab))).toEqual(["changes"]);
    expect(readPanelTabs<Tab>("session_b", isTab).open).toBe(true);
  });

  test("one project's canvas is not another's", () => {
    writePanelTabs(canvasPanelKey("project_1"), openPanelTab(emptyPanelTabs<Tab>(), "run"), 1);
    expect(readPanelTabs<Tab>(canvasPanelKey("project_2"), isTab)).toEqual(emptyPanelTabs<Tab>());
  });

  test("clearing a key that was never written is not an error", () => {
    expect(() => clearPanelTabs(canvasPanelKey("project_never"))).not.toThrow();
  });

  test("clearing the canvas leaves every session's panel untouched", () => {
    writePanelTabs("session_a", openPanelTab(emptyPanelTabs<Tab>(), "run"), 1);
    writePanelTabs(canvasPanelKey("project_1"), openPanelTab(emptyPanelTabs<Tab>(), "editor"), 1);
    clearPanelTabs(canvasPanelKey("project_1"));
    expect(kinds(readPanelTabs<Tab>("session_a", isTab))).toEqual(["run"]);
  });
});
