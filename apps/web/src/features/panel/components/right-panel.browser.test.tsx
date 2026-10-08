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

function installBrowser() {
  let state: DesktopBrowserPanelState = { scopeKey: "session_a", tabs: [page("a", 0, true), page("b", 1, false)] };
  const actions: Record<string, unknown>[] = [];
  const scopes: string[] = [];
  const visible: boolean[] = [];
  let subscriptions = 0;
  const bridge = {
    getState: async (scopeKey: string) => (scopes.push(scopeKey), state),
    action: async (_scope: string, action: Record<string, unknown>) => {
      actions.push(action);
      if (action.action === "select") state = { ...state, tabs: state.tabs.map((tab) => ({ ...tab, active: tab.index === action.index })) };
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
  return { actions, scopes, visible, subscriptions: () => subscriptions };
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
    return <RightPanel sessionId="session_a" projectId="project_a" tabs={tabs} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} onClose={() => {}} />;
  }
  const { host } = await mount(<Panel />);
  await flush(() => host.querySelector('[aria-label="Address"]') !== null);
  expect(host.querySelector('[aria-label="New tab"]')).toBeNull();
  expect(browser.actions).toEqual([]);
  expect(new Set(browser.scopes)).toEqual(new Set(["session_a"]));

  const subscribed = browser.subscriptions();
  await act(async () => select("browser:b"));
  await flush(() => browser.actions.length > 0);
  expect(browser.actions).toEqual([{ action: "select", index: 1 }]);
  expect(browser.subscriptions()).toBe(subscribed);
});

test("moving to a tab that is not a browser page takes the native view down, and coming back puts it up", async () => {
  const browser = installBrowser();
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) }) as DOMRect;
  try {
    let select: (id: string) => void = () => undefined;
    const strip: PanelTabItem[] = [...tabs, { id: "editor", kind: "editor", params: {} }];
    function Panel() {
      const [active, setActive] = useState("browser:a");
      select = setActive;
      return <RightPanel sessionId="session_a" projectId="project_a" tabs={strip} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} onClose={() => {}} />;
    }
    await mount(<Panel />);
    await flush(() => browser.visible.at(-1) === true);
    expect(browser.visible.at(-1)).toBe(true);

    await act(async () => select("editor"));
    await flush(() => browser.visible.at(-1) === false);
    expect(browser.visible.at(-1)).toBe(false);

    await act(async () => select("browser:b"));
    await flush(() => browser.visible.at(-1) === true);
    expect(browser.visible.at(-1)).toBe(true);
  } finally {
    if (own) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", own);
    else delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  }
});
