import { expect, test } from "bun:test";
import { createPanelModel, panelKey, type PanelStorage } from "./model";

function memory(seed: Record<string, unknown> = {}): PanelStorage {
  const values = new Map(Object.entries(seed));
  return { get: (key) => values.get(key), set: (key, value) => void values.set(key, value) };
}

const KEY = panelKey("host-1", "session-1");

test("a new session's panel opens empty, offering every surface", () => {
  const panel = createPanelModel(KEY, memory());
  panel.open();
  expect(panel.state()).toEqual({ isOpen: true, fullScreen: false, tabs: [], active: undefined });
  expect(panel.openable()).toEqual(["diff", "editor", "agents", "simulator", "terminal", "browser"]);
});

test("tabs, the active tab and openness come back for the same session only", () => {
  const storage = memory();
  const panel = createPanelModel(KEY, storage);
  panel.open("diff");
  panel.open("editor");
  panel.select("diff");
  expect(createPanelModel(KEY, storage).state()).toEqual({ isOpen: true, fullScreen: false, tabs: ["diff", "editor"], active: "diff" });
  expect(createPanelModel(panelKey("host-1", "session-2"), storage).state()).toEqual({ isOpen: false, fullScreen: false, tabs: [], active: undefined });
});

test("closing the active tab moves to the one after it, or the last", () => {
  const panel = createPanelModel(KEY, memory());
  panel.open("diff");
  panel.open("editor");
  panel.open("terminal");
  panel.select("editor");
  panel.closeTab("editor");
  expect(panel.state().active).toBe("terminal");
  panel.closeTab("terminal");
  expect(panel.state()).toMatchObject({ tabs: ["diff"], active: "diff" });
  expect(panel.openable()).not.toContain("diff");
});

test("a dismissed panel keeps its tabs closed, and a saved one with no tabs restores closed", () => {
  const storage = memory();
  const panel = createPanelModel(KEY, storage);
  panel.open("diff");
  panel.close();
  expect(createPanelModel(KEY, storage).state()).toEqual({ isOpen: false, fullScreen: false, tabs: ["diff"], active: "diff" });
  const empty = memory({ [KEY]: JSON.stringify({ isOpen: true, fullScreen: false, tabs: [] }) });
  expect(createPanelModel(KEY, empty).state().isOpen).toBe(false);
});

test("unknown tabs, a stale active tab and garbage are dropped on restore", () => {
  const stale = memory({ [KEY]: JSON.stringify({ isOpen: true, fullScreen: false, tabs: ["diff", "page:9", "diff", "agents"], active: "page:9" }) });
  expect(createPanelModel(KEY, stale).state()).toEqual({ isOpen: true, fullScreen: false, tabs: ["diff", "agents"], active: "diff" });
  expect(createPanelModel(KEY, memory({ [KEY]: "{not json" })).state()).toEqual({ isOpen: false, fullScreen: false, tabs: [], active: undefined });
});

test("subscribers hear every change", () => {
  const panel = createPanelModel(KEY, memory());
  let heard = 0;
  const stop = panel.subscribe(() => heard++);
  panel.open("diff");
  panel.select("diff");
  stop();
  panel.close();
  expect(heard).toBe(1);
});

test("filling the window opens the panel, survives a relaunch and ends when the panel closes", () => {
  const storage = memory();
  const panel = createPanelModel(KEY, storage);
  panel.setFullScreen(true);
  expect(panel.state()).toMatchObject({ isOpen: true, fullScreen: true });
  panel.open("diff");
  expect(createPanelModel(KEY, storage).state()).toMatchObject({ isOpen: true, fullScreen: true, active: "diff" });
  panel.close();
  expect(panel.state()).toMatchObject({ isOpen: false, fullScreen: false });
  panel.open();
  expect(panel.state().fullScreen).toBe(false);
});

test("a reference and a file to open wait for whoever takes them, and are never saved", () => {
  const storage = memory();
  const panel = createPanelModel(KEY, storage);
  panel.insertReference("`src/app.ts`");
  panel.openFile("src/app.ts");
  expect(panel.state()).toMatchObject({ isOpen: true, tabs: ["editor"], active: "editor", reference: "`src/app.ts`", opening: "src/app.ts" });
  expect(createPanelModel(KEY, storage).state()).toEqual({ isOpen: true, fullScreen: false, tabs: ["editor"], active: "editor" });
  panel.clearReference();
  panel.clearOpening();
  expect(panel.state().reference).toBeUndefined();
  expect(panel.state().opening).toBeUndefined();
});
