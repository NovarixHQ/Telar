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
  let subscriptions = 0;
  const bridge = {
    getState: async (scopeKey: string) => (scopes.push(scopeKey), state),
    action: async (_scope: string, action: Record<string, unknown>) => {
      actions.push(action);
      if (action.action === "select") state = { ...state, tabs: state.tabs.map((tab) => ({ ...tab, active: tab.index === action.index })) };
      return state;
    },
    setBounds: async () => {},
    setVisible: async () => {},
    onState: () => {
      subscriptions += 1;
      return () => {};
    },
  } as unknown as DesktopBrowserBridge;
  (window as { telarDesktop?: unknown }).telarDesktop = { browser: bridge };
  return { actions, scopes, subscriptions: () => subscriptions };
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
