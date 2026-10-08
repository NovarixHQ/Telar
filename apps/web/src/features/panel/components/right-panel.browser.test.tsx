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

async function nativeViewAt(strip: PanelTabItem[], steps: string[], flatTabs = true): Promise<boolean[]> {
  const browser = installBrowser();
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON: () => ({}) }) as DOMRect;
  try {
    let select: (id: string) => void = () => undefined;
    function Panel() {
      const [active, setActive] = useState(steps[0]!);
      select = setActive;
      return <RightPanel sessionId="session_a" projectId="project_a" tabs={strip} tab={active} onTabChange={setActive} onOpenTab={() => {}} onCloseTab={() => {}} onClose={() => {}} flatTabs={flatTabs} />;
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

test("outside the flat-tabs trial, leaving the one Browser tab takes the native view down, and coming back puts it up", async () => {
  const strip: PanelTabItem[] = [
    { id: "browser:__integrated__", kind: "browser:__integrated__", params: {} },
    { id: "editor", kind: "editor", params: {} },
  ];
  expect(await nativeViewAt(strip, ["browser:__integrated__", "editor", "browser:__integrated__"], false)).toEqual([true, false, true]);
});

test("outside the flat-tabs trial the one Browser tab draws the browser's own page strip and leaves the page alone", async () => {
  const browser = installBrowser();
  const live: PanelTabItem[] = [{ id: "browser:__integrated__", kind: "browser:__integrated__", params: {} }];
  const { host } = await mount(
    <RightPanel sessionId="session_a" projectId="project_a" tabs={live} tab="browser:__integrated__" onTabChange={() => {}} onOpenTab={() => {}} onCloseTab={() => {}} onClose={() => {}} flatTabs={false} />,
  );
  await flush(() => host.querySelector('[aria-label="New tab"]') !== null);
  expect(host.querySelector('[aria-label="New tab"]')).not.toBeNull();
  expect(browser.actions).toEqual([]);
});
