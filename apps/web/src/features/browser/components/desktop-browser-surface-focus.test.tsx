import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopBrowserBridge, DesktopBrowserPanelState, DesktopBrowserTab } from "../types";
import { DesktopBrowserSurface } from "./desktop-browser-surface";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tab = (patch: Partial<DesktopBrowserTab> = {}): DesktopBrowserTab => ({
  index: 0,
  id: "tab_1",
  title: "App",
  url: "http://localhost:3000/",
  active: true,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 1,
  colorScheme: "system",
  viewport: { width: 1280, height: 800, preset: "default", mode: "fit" },
  ...patch,
});

const panelState = (tabs: DesktopBrowserTab[]): DesktopBrowserPanelState => ({
  scopeKey: "session_a",
  tabs,
  profile: { id: "bp_1", label: "Work", partition: "persist:telar-profile-bp_1" },
  profiles: [{ id: "bp_1", label: "Work", partition: "persist:telar-profile-bp_1" }],
  presentation: { width: 1280, height: 800, scale: 0.5, rect: { x: 0, y: 0, width: 640, height: 400 } },
});

const settle = () => Promise.resolve();

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("a focused composer while the browser tab changes", () => {
  test("keeps focus and its caret through loads, redirects, retitles and a failed load", async () => {
    let latest = panelState([tab()]);
    const listeners: ((state: DesktopBrowserPanelState) => void)[] = [];
    const bridge: DesktopBrowserBridge = {
      getState: async () => latest,
      action: async () => latest,
      setBounds: async () => {},
      setVisible: async () => {},
      onState: (listener) => {
        listeners.push(listener);
        return () => void listeners.splice(listeners.indexOf(listener), 1);
      },
      setScopeProfile: async () => ({ profileId: "bp_1", partition: "persist:telar-profile-bp_1" }),
    };
    const push = (tabs: DesktopBrowserTab[]) => act(async () => {
      latest = panelState(tabs);
      for (const listener of [...listeners]) listener(latest);
      await settle();
    });

    const composer = document.createElement("textarea");
    composer.setAttribute("aria-label", "Message");
    document.body.appendChild(composer);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<DesktopBrowserSurface bridge={bridge} scopeKey="session_a" projectId="project_a" />);
      await settle();
    });

    composer.value = "half a thought";
    composer.focus();
    composer.setSelectionRange(4, 4);

    await push([tab({ loading: true })]);
    await push([tab({ loading: true, url: "http://localhost:3000/login" })]);
    await push([tab({ url: "http://localhost:3000/login", title: "Sign in", favicon: "http://localhost:3000/favicon.ico" })]);
    await push([tab({ loadError: { code: "ERR_CONNECTION_REFUSED", url: "http://localhost:3000/" } })]);
    await push([tab({ loadError: null, title: "App" })]);
    await push([tab({ active: false }), tab({ index: 1, id: "tab_2", url: "https://agent.example/", title: "Agent" })]);

    expect(host.textContent).toContain("Agent");
    expect(document.activeElement).toBe(composer);
    expect(composer.selectionStart).toBe(4);

    act(() => root.unmount());
    host.remove();
    composer.remove();
  });
});
