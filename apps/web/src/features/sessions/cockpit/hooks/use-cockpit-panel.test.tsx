import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { keymapSnapshot, resolveCommandForEvent, runCommand, type CommandId } from "@/features/commands";
import { writePanelTabs, type PanelTab, type PanelTabState } from "@/features/panel";
import { SidebarProvider } from "@/ui/sidebar";
import { flush, installTestDom, mount } from "@/test/dom";
import { useCockpitCommands } from "./use-cockpit-commands";
import { useCockpitPanel } from "./use-cockpit-panel";

installTestDom();

type Strip = PanelTabState<PanelTab>;
type Desktop = { browser?: unknown; terminal?: unknown };
const desktop = (bridges: Desktop) => ((window as unknown as { telarDesktop?: Desktop }).telarDesktop = bridges);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
});

async function cockpit(stored?: Strip) {
  if (stored) writePanelTabs("session_a", stored, 1);
  let hook: ReturnType<typeof useCockpitPanel> | undefined;
  function Probe() {
    hook = useCockpitPanel({ panelKey: "session_a", enabledPlugins: [], hostId: "local", sessionId: "session_a" });
    useCockpitCommands({ solo: false, pluginPanels: [], panel: hook, openBrowser: () => {}, pinSession: () => {} });
    return null;
  }
  await mount(
    <SidebarProvider>
      <Probe />
    </SidebarProvider>,
  );
  await flush(() => !stored || hook!.panel.tabs.length > 0);
  return () => hook!;
}

const ids = (panel: Strip) => panel.tabs.map((tab) => tab.id);
const terminalIds = (panel: Strip) => panel.tabs.filter((tab) => tab.kind === "terminal").map((tab) => tab.params.terminal);

test("two terminals make two tabs", async () => {
  const hook = await cockpit();
  await act(async () => hook().showNewPanelTab("terminal"));
  await act(async () => hook().showNewPanelTab("terminal"));
  expect(ids(hook().panel)).toEqual(["terminal", "terminal#2"]);
  expect(hook().panel.activeTab).toBe("terminal#2");
});

test("a Terminal tab saved by the grouped panel restores as one tab per shell", async () => {
  const shells = JSON.stringify({ shells: [{ id: "shell", terminalId: "pty_1" }, { id: "shell#2", terminalId: "pty_2" }], active: "shell#2" });
  const hook = await cockpit({ tabs: [{ id: "terminal", kind: "terminal", params: { shells } }, { id: "diff", kind: "diff", params: {} }], activeTab: "terminal", open: true });
  expect(ids(hook().panel)).toEqual(["terminal", "terminal#2", "diff"]);
  expect(terminalIds(hook().panel)).toEqual(["pty_1", "pty_2"]);
  expect(hook().panel.activeTab).toBe("terminal#2");
});

test("closing a Terminal tab closes its shell and only that tab", async () => {
  const closed: string[] = [];
  desktop({ terminal: { active: async () => ({ terminals: [] }), close: async (id: string) => (closed.push(id), { ok: true }) } });
  const hook = await cockpit({
    tabs: [
      { id: "terminal", kind: "terminal", params: { terminal: "pty_1" } },
      { id: "terminal#2", kind: "terminal", params: { terminal: "pty_2" } },
    ],
    activeTab: "terminal",
    open: true,
  });
  await act(async () => hook().tabHandlers.onCloseTab("terminal#2"));
  await flush(() => hook().panel.tabs.length === 1);
  expect(closed).toEqual(["pty_2"]);
  expect(terminalIds(hook().panel)).toEqual(["pty_1"]);
});

test("the tab arrows step through every tab and wrap", async () => {
  const hook = await cockpit();
  for (let n = 0; n < 3; n += 1) await act(async () => hook().showNewPanelTab("terminal"));
  await act(async () => hook().stepPanelTab(1));
  expect(hook().panel.activeTab).toBe("terminal");
  await act(async () => hook().stepPanelTab(-1));
  expect(hook().panel.activeTab).toBe("terminal#3");
});

test("⌃⌘2 selects the second tab and ⌃⌘9 the last", async () => {
  const tabs = (["diff", "issues", "pulls"] as const).map((id) => ({ id, kind: id, params: {} }));
  const hook = await cockpit({ tabs, activeTab: "diff", open: false });
  const press = (key: string) => act(async () => void runCommand(resolveCommandForEvent(keymapSnapshot(), { key, metaKey: true, ctrlKey: true }) as CommandId));
  await press("2");
  expect(hook().panel.activeTab).toBe("issues");
  expect(hook().panel.open).toBe(true);
  await press("9");
  expect(hook().panel.activeTab).toBe("pulls");
  await press("5");
  expect(hook().panel.activeTab).toBe("pulls");
});

describe("Close panel tab", () => {
  const strip = (open: boolean): Strip => ({ tabs: [{ id: "diff", kind: "diff", params: {} }, { id: "issues", kind: "issues", params: {} }], activeTab: "issues", open });

  test("closes the tab in front", async () => {
    const hook = await cockpit(strip(true));
    await act(async () => void runCommand("close-panel-tab"));
    expect(ids(hook().panel)).toEqual(["diff"]);
    expect(hook().panel.activeTab).toBe("diff");
  });

  test("does nothing with no tabs or with the panel closed", async () => {
    const empty = await cockpit();
    await act(async () => void runCommand("close-panel-tab"));
    expect(ids(empty().panel)).toEqual([]);
    const hidden = await cockpit(strip(false));
    await act(async () => void runCommand("close-panel-tab"));
    expect(ids(hidden().panel)).toEqual(["diff", "issues"]);
  });

  test("a terminal with a running process asks before it closes", async () => {
    const asked: string[] = [];
    const confirm = spyOn(window, "confirm").mockImplementation((message?: string) => (asked.push(String(message)), false));
    try {
      desktop({ terminal: { active: async () => ({ terminals: [{ id: "pty_1", active: true, processes: 1, command: "vim" }] }), close: async () => ({ ok: true }) } });
      const hook = await cockpit({ tabs: [{ id: "terminal", kind: "terminal", params: { terminal: "pty_1" } }], activeTab: "terminal", open: true });
      await act(async () => void runCommand("close-panel-tab"));
      await flush(() => asked.length > 0);
      expect(ids(hook().panel)).toEqual(["terminal"]);
    } finally {
      confirm.mockRestore();
    }
  });
});

describe("in the desktop app", () => {
  let pages: { id: string; index: number; active: boolean }[];
  let actions: Record<string, unknown>[];
  let emit: (state: unknown) => void;
  beforeEach(() => {
    pages = [
      { id: "a", index: 0, active: false },
      { id: "b", index: 1, active: true },
    ];
    actions = [];
    emit = () => undefined;
    desktop({
      browser: {
        getState: async (scopeKey: string) => ({ scopeKey, tabs: pages }),
        onState: (listener: (state: unknown) => void) => ((emit = listener), () => undefined),
        action: async (_scope: string, action: Record<string, unknown>) => (actions.push(action), {}),
      },
    });
  });

  test("two pages make two tabs", async () => {
    const hook = await cockpit({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: true });
    await flush(() => hook().panel.tabs.length === 3);
    expect(ids(hook().panel)).toEqual(["diff", "browser:a", "browser:b"]);
  });

  test("closing a page's tab closes that page", async () => {
    const hook = await cockpit({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: true });
    await flush(() => hook().panel.tabs.length === 3);
    await act(async () => hook().tabHandlers.onCloseTab("browser:a"));
    await flush(() => actions.length > 0);
    expect(actions).toEqual([{ action: "close", id: "a" }]);
    expect(ids(hook().panel)).toEqual(["diff", "browser:b"]);
  });

  test("a page back from picture in picture returns as its own tab", async () => {
    const hook = await cockpit({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: true });
    await flush(() => hook().panel.tabs.length === 3);
    await act(async () => emit({ scopeKey: "session_a", popped: true, compact: true, tabs: [pages[0]] }));
    expect(ids(hook().panel)).toEqual(["diff", "browser:a"]);
    await act(async () => emit({ scopeKey: "session_a", tabs: pages }));
    expect(ids(hook().panel)).toEqual(["diff", "browser:a", "browser:b"]);
  });

  test("a Browser tab saved by the grouped panel gives way to the browser's pages", async () => {
    const hook = await cockpit({ tabs: [{ id: "browser:__integrated__", kind: "browser:__integrated__", params: {} }], activeTab: "browser:__integrated__", open: true });
    await flush(() => hook().panel.tabs.length === 2);
    expect(ids(hook().panel)).toEqual(["browser:a", "browser:b"]);
  });
});
