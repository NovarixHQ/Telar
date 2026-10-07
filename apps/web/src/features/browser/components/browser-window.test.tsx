import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesktopBrowserBridge, DesktopBrowserPanelState } from "../types";

GlobalRegistrator.register({ url: "http://localhost/surface/browser" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let query = new URLSearchParams();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/surface/browser",
  useSearchParams: () => query,
}));

const { BrowserWindowSurface } = await import("./browser-window");

const state: DesktopBrowserPanelState = {
  scopeKey: "session_a#browser-2",
  popped: true,
  tabs: [{ index: 0, id: "tab_1", title: "Example", url: "https://example.com/", active: true, loading: false, canGoBack: false, canGoForward: false }],
};

const asked: string[] = [];
const bound: [string, string][] = [];
const bridge: DesktopBrowserBridge = {
  getState: async (scope) => {
    asked.push(scope);
    return state;
  },
  action: async () => state,
  setBounds: async () => {},
  setVisible: async () => {},
  onState: () => () => {},
  bindProfile: async (scopeKey, profileKey) => {
    bound.push([scopeKey, profileKey]);
    return { scopeKey, profileKey, partition: "persist:telar-profile-bp_1" };
  },
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function show(params: Record<string, string>) {
  query = new URLSearchParams(params);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<BrowserWindowSurface />);
  });
  for (let attempt = 0; attempt < 25 && !host.querySelector('[role="tab"]') && !host.textContent?.includes("no browser"); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  asked.length = 0;
  bound.length = 0;
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("the browser's own window", () => {
  test("draws the whole browser for the scope it was opened on, under that project", async () => {
    (window as { telarDesktop?: unknown }).telarDesktop = { browser: bridge };
    await show({ scope: "session_a#browser-2", project: "project_a" });
    expect(asked).toContain("session_a#browser-2");
    expect(bound).toContainEqual(["session_a#browser-2", "project_a"]);
    expect(host!.querySelector('[role="tab"]')).not.toBeNull();
    expect(host!.textContent).not.toContain("In its own window");
  });

  test("says so when it has no scope or no shell to draw from", async () => {
    (window as { telarDesktop?: unknown }).telarDesktop = { browser: bridge };
    await show({});
    expect(host!.textContent).toContain("This window has no browser to show.");
    await act(async () => root!.unmount());
    host!.remove();

    delete (window as { telarDesktop?: unknown }).telarDesktop;
    await show({ scope: "session_a" });
    expect(host!.textContent).toContain("This window has no browser to show.");
  });
});
