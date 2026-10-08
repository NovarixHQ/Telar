import { afterEach, describe, expect, test } from "bun:test";
import { act, useCallback, useState } from "react";
import { installTestDom, mount, flush } from "@/test/dom";
import { closeNativePage } from "@/features/browser/native-pages";
import type { DesktopBrowserBridge, DesktopBrowserPanelState } from "@/features/browser/types";
import { browserPanelTab, closePanelTab, type PanelTab, type PanelTabState } from "@/features/panel";
import { useBrowserPageTabs } from "./use-browser-page-tabs";

installTestDom();

const page = (id: string, index: number) => ({ id, index, active: index === 0, title: id, url: "", loading: false, canGoBack: false, canGoForward: false });

function fakeShell(ids: string[]) {
  let pages = ids;
  const listeners = new Set<(state: DesktopBrowserPanelState) => void>();
  let finishClose = () => {};
  const state = () => ({ scopeKey: "s1", tabs: pages.map(page) }) as DesktopBrowserPanelState;
  const bridge = {
    getState: async () => state(),
    onState: (listener: (next: DesktopBrowserPanelState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    action: (_scope: string, action: { index: number }) =>
      new Promise((resolve) => {
        finishClose = () => {
          pages = pages.filter((_, index) => index !== action.index);
          resolve(state());
        };
      }),
  } as unknown as DesktopBrowserBridge;
  return { bridge, emit: () => listeners.forEach((listener) => listener(state())), finish: () => finishClose() };
}

let strip: PanelTabState<PanelTab> | undefined;
let close: ((id: string) => void) | undefined;

function Panel({ bridge }: { bridge: DesktopBrowserBridge }) {
  const [panel, setPanel] = useState<PanelTabState<PanelTab>>({ tabs: [], open: true });
  const update = useCallback((next: (current: PanelTabState<PanelTab>) => PanelTabState<PanelTab>) => setPanel(next), []);
  useBrowserPageTabs("s1", update, () => false);
  strip = panel;
  close = (id) => {
    void closeNativePage(bridge, "s1", id);
    update((current) => closePanelTab(current, browserPanelTab(id)));
  };
  return null;
}

const ids = () => strip!.tabs.map((tab) => tab.id);

afterEach(() => {
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});

describe("closing a page's tab", () => {
  test("stays closed when the browser reports its state before the page is gone", async () => {
    const shell = fakeShell(["a", "b"]);
    (window as unknown as { telarDesktop: unknown }).telarDesktop = { browser: shell.bridge };
    await mount(<Panel bridge={shell.bridge} />);
    await flush(() => ids().length === 2);
    expect(ids()).toEqual([browserPanelTab("a"), browserPanelTab("b")]);

    await act(async () => close!("b"));
    await act(async () => shell.emit());
    expect(ids()).toEqual([browserPanelTab("a")]);

    await act(async () => shell.finish());
    await act(async () => shell.emit());
    expect(ids()).toEqual([browserPanelTab("a")]);
  });
});
