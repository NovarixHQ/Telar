import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { canvasPanelKey, emptyPanelTabs, isRestorablePanelTab, openPanelTab, readPanelTabs, writePanelTabs, type PanelTab } from "@/features/panel";
import { emptyEditor, openInEditor, readEditor, writeEditor } from "@/features/files";
import { handOffCanvas } from "./canvas-handoff";

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

const canvas = canvasPanelKey("project_1");
const withTerminal = () => openPanelTab(emptyPanelTabs<PanelTab>(), "terminal", { shells: JSON.stringify({ shells: [{ id: "shell" }], active: "shell" }) });

describe("the first message's hand-off", () => {
  test("the session it creates keeps the terminal opened while writing it", () => {
    const panel = withTerminal();
    writePanelTabs(canvas, panel, 1);
    handOffCanvas("session_a", "project_1", { panel, editors: {} });
    const restored = readPanelTabs("session_a", isRestorablePanelTab);
    expect(restored.open).toBe(true);
    expect(restored.tabs.map((tab) => tab.kind)).toEqual(["terminal"]);
  });

  test("the next new conversation in the project opens without that terminal", () => {
    const panel = withTerminal();
    writePanelTabs(canvas, panel, 1);
    handOffCanvas("session_a", "project_1", { panel, editors: {} });
    expect(readPanelTabs(canvas, isRestorablePanelTab)).toEqual(emptyPanelTabs<PanelTab>());
  });

  test("the next new conversation opens without the files either", () => {
    const editor = openInEditor(emptyEditor(), { path: "notes.md", view: "code" }, "pin");
    writeEditor(canvas, editor, 1);
    handOffCanvas("session_a", "project_1", { panel: emptyPanelTabs<PanelTab>(), editors: { editor } });
    expect(readEditor(canvas).files).toEqual([]);
    expect(readEditor("session_a").files.map((file) => file.path)).toEqual(["notes.md"]);
  });
});
