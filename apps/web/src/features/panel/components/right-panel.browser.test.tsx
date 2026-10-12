import { afterEach, expect, test } from "bun:test";
import { act, useState } from "react";
import { RightPanel } from "./right-panel";
import type { DesktopBrowserBridge, DesktopBrowserPanelState } from "@/features/browser";
import { flush, installTestDom, mount } from "@/test/dom";
import type { PanelTabItem } from "../model";

installTestDom();

afterEach(() => {
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});

const page = (id: string, index: number, active: boolean) => ({ id, index, active, title: id, url: `https://${id}.test/`, loading: false, canGoBack: false, canGoForward: false });

function installBrowser(ids = ["a", "b"]) {
  let state: DesktopBrowserPanelState = { scopeKey: "session_a", tabs: ids.map((id, index) => page(id, index, index === 0)) };
  const actions: Record<string, unknown>[] = [];
  const scopes: string[] = [];
  const visible: boolean[] = [];
  let subscriptions = 0;
  const bridge = {
    getState: async (scopeKey: string) => (scopes.push(scopeKey), state),
    action: async (_scope: string, action: Record<string, unknown>) => {
      actions.push(action);
      const target = action.id === undefined ? state.tabs[Number(action.index)] : state.tabs.find((tab) => tab.id === action.id);
      if (!target) throw new Error(`Browser tab ${String(action.index)} does not exist.`);
      if (action.action === "select") state = { ...state, tabs: state.tabs.map((tab) => ({ ...tab, active: tab.id === target.id })) };
      return state;
    },
    setBounds: async () => {},
    setVisible: async (_scope: string, shown: boolean) => {
      visible.push(shown);
    },
    onState: () => {
      subscriptions += 1;
      return () => {};
    },
  } as unknown as DesktopBrowserBridge;
  (window as { telarDesktop?: unknown }).telarDesktop = { browser: bridge };
  const closeQuietly = (id: string) => {
    state = { ...state, tabs: state.tabs.filter((tab) => tab.id !== id).map((tab, index) => ({ ...tab, index })) };
  };
  return { actions, scopes, visible, subscriptions: () => subscriptions, closeQuietly, state: () => state };
}

const tabs: PanelTabItem[] = [
  { id: "browser:a", kind: "browser:a", params: {} },
  { id: "browser:b", kind: "browser:b", params: {} },
];

test("a page tab draws the session's one browser on that page, and moving between page tabs keeps it mounted", async () => {
  const browser = installBrowser();
  let select: (id: string) => void = () => undefined;
  function Panel() {
    const [active, setActive] = useState("browser:a");
    select = setActive;
    return <RightPanel sessionId="session_a" projectId="project_a" tabs={tabs} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} />;
  }
  const { host } = await mount(<Panel />);
  await flush(() => host.querySelector('[aria-label="Address"]') !== null);
  expect(host.querySelector('[aria-label="New tab"]')).toBeNull();
  expect(browser.actions).toEqual([]);
  expect(new Set(browser.scopes)).toEqual(new Set(["session_a"]));

  const subscribed = browser.subscriptions();
  await act(async () => select("browser:b"));
  await flush(() => browser.actions.length > 0);
  expect(browser.actions).toEqual([{ action: "select", id: "b" }]);
  expect(browser.subscriptions()).toBe(subscribed);
});

test("closing a page and switching to another before the panel hears of it shows no error and lands on that page", async () => {
  const browser = installBrowser(["a", "b", "c"]);
  const strip: PanelTabItem[] = ["a", "b", "c"].map((id) => ({ id: `browser:${id}`, kind: `browser:${id}`, params: {} }));
  let select: (id: string) => void = () => undefined;
  function Panel() {
    const [active, setActive] = useState("browser:a");
    select = setActive;
    return <RightPanel sessionId="session_a" projectId="project_a" tabs={strip} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} />;
  }
  const { host } = await mount(<Panel />);
  await flush(() => host.querySelector('[aria-label="Address"]') !== null);

  browser.closeQuietly("b");
  await act(async () => select("browser:c"));
  await flush(() => browser.actions.length > 0);
  await flush(() => browser.state().tabs.find((tab) => tab.active)?.id === "c");
  expect(host.textContent).not.toContain("does not exist");
});

async function nativeViewAt(strip: PanelTabItem[], steps: string[]): Promise<boolean[]> {
  const browser = installBrowser();
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) }) as DOMRect;
  try {
    let select: (id: string) => void = () => undefined;
    function Panel() {
      const [active, setActive] = useState(steps[0]!);
      select = setActive;
      return <RightPanel sessionId="session_a" projectId="project_a" tabs={strip} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} />;
    }
    await mount(<Panel />);
    const seen: boolean[] = [];
    for (const [index, step] of steps.entries()) {
      const page = step.startsWith("browser:");
      if (index > 0) await act(async () => select(step));
      await flush(() => browser.visible.at(-1) === page);
      seen.push(browser.visible.at(-1) === true);
    }
    return seen;
  } finally {
    if (own) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", own);
    else delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  }
}

test("moving to a tab that is not a browser page takes the native view down, and coming back puts it up", async () => {
  expect(await nativeViewAt([...tabs, { id: "editor", kind: "editor", params: {} }], ["browser:a", "editor", "browser:b"])).toEqual([true, false, true]);
});
