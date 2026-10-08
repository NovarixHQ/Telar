import { describe, expect, test } from "bun:test";
import type { EngineEvent } from "@telar/engine-client";
import type { DesktopBrowserBridge } from "@/features/browser/types";
import { flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { sessionHref } from "../../session-list";
import { useSessionBrowser, type DraftChoices } from "./use-session-browser";

installTestDom();

const draft: DraftChoices = {
  driver: "claude",
  envMode: "local",
  base: {},
  pick: { kind: "default" } as never,
  runtimeMode: "interactive" as never,
};

function withBridge(bridge: DesktopBrowserBridge | undefined) {
  (window as unknown as { telarDesktop?: { browser?: DesktopBrowserBridge } }).telarDesktop = bridge ? { browser: bridge } : undefined;
}

function nativeBrowser(pages: [string, boolean][], actions: Record<string, unknown>[] = []): DesktopBrowserBridge {
  const state = (scopeKey: string) => ({ scopeKey, tabs: pages.map(([id, active], index) => ({ id, index, active })) });
  return {
    getState: async (scopeKey: string) => state(scopeKey),
    action: async (scopeKey: string, action: Record<string, unknown>) => {
      actions.push(action);
      if (action.action === "new") {
        for (const page of pages) page[1] = false;
        pages.push([`n${pages.length + 1}`, true]);
      }
      return state(scopeKey);
    },
  } as unknown as DesktopBrowserBridge;
}

const pageEvent = (ids: string[]) =>
  ({ id: 1, at: 1, sessionId: "session_1", type: "browser.state.changed", provider: "integrated", tabs: ids.map((id) => ({ id, title: id, url: `https://${id}.test/` })) }) as unknown as EngineEvent;

async function probe({ sessionId = "session_1", bridge, events = [], canStart = true, flat = true }: { sessionId?: string; bridge?: DesktopBrowserBridge; events?: EngineEvent[]; canStart?: boolean; flat?: boolean }) {
  withBridge(bridge);
  const starts: string[] = [];
  let started = () => {};
  stubFetch({
    "GET /api/sessions/session_1/browser": () => (started(), { browser: { scopeKey: "session_1", provider: "none", running: false, tabs: [], canStart } }),
    "POST /api/sessions/session_1/browser": () => {
      starts.push("start");
      return { browser: { scopeKey: "session_1", provider: "integrated", running: true, tabs: [], canStart } };
    },
  });
  const shown: string[] = [];
  const panel = { flat, showPanelTab: (tab: string) => shown.push(tab), pageTab: (id: string) => (flat ? `browser:${id}` : "browser:__integrated__") };
  let result: ReturnType<typeof useSessionBrowser> | undefined;
  function Probe() {
    result = useSessionBrowser({
      hostId: "local",
      sessionId,
      projectId: "project_1",
      sync: { transcriptLanded: true, events, setSession: () => {} } as never,
      draft,
      composer: {} as never,
      panel: panel as never,
      setCreatedSessionId: () => {},
    });
    return null;
  }
  const mounted = await mount(<Probe />);
  await flush();
  await flush();
  return {
    result: () => result!,
    shown,
    starts,
    onStart: (run: () => void) => { started = run; },
    unmount: () => {
      mounted.unmount();
      withBridge(undefined);
    },
  };
}

describe("the one Browser entry", () => {
  test("with a page open it shows the last page and starts nothing", async () => {
    const view = await probe({ events: [pageEvent(["a", "b"])] });
    await view.result().openBrowser();
    expect(view.shown).toEqual(["browser:b"]);
    expect(view.starts).toEqual([]);
    view.unmount();
  });

  test("in the desktop app with a browser running it opens a new page as a new tab", async () => {
    const actions: Record<string, unknown>[] = [];
    const view = await probe({ bridge: nativeBrowser([["n1", false], ["n2", true]], actions), events: [pageEvent(["a"])] });
    await view.result().openBrowser();
    expect(actions).toEqual([{ action: "new" }]);
    expect(view.shown).toEqual(["browser:n3"]);
    expect(view.starts).toEqual([]);
    await view.result().openBrowser();
    expect(view.shown).toEqual(["browser:n3", "browser:n4"]);
    view.unmount();
  });

  test("in the desktop app with no native page it starts the browser, then shows the page it opened", async () => {
    const pages: [string, boolean][] = [];
    const view = await probe({ bridge: nativeBrowser(pages) });
    let starts = 0;
    view.onStart(() => {
      starts += 1;
      pages.push(["n1", true]);
    });
    window.history.replaceState(null, "", sessionHref({ id: "session_1", projectId: "project_1", hostId: "local" }));
    await view.result().openBrowser();
    expect(starts).toBe(1);
    expect(view.shown).toEqual(["browser:n1"]);
    window.history.replaceState(null, "", "/");
    view.unmount();
  });

  test("is never dimmed while a page is open, even where nothing can start", async () => {
    const view = await probe({ events: [pageEvent(["a"])] });
    expect(view.result().browserUnavailable).toBeUndefined();
    view.unmount();
  });

  test("without pages it is dimmed outside the desktop app, with the reason", async () => {
    const view = await probe({});
    expect(view.result().browserUnavailable).toBe("Starting a browser needs the desktop app");
    view.unmount();
  });

  test("without pages in the desktop app it follows the engine", async () => {
    const able = await probe({ bridge: {} as DesktopBrowserBridge });
    expect(able.result().browserUnavailable).toBeUndefined();
    able.unmount();
    const unable = await probe({ bridge: {} as DesktopBrowserBridge, canStart: false });
    expect(unable.result().browserUnavailable).toBe("This session can't start a browser");
    unable.unmount();
  });

  test("outside the flat-tabs trial, a running browser gets a new page in its one Browser tab", async () => {
    const pages: [string, boolean][] = [["n1", true]];
    const actions: Record<string, unknown>[] = [];
    const view = await probe({ bridge: nativeBrowser(pages, actions), flat: false });
    await view.result().openBrowser();
    expect(actions).toEqual([{ action: "new" }]);
    expect(pages).toEqual([["n1", false], ["n2", true]]);
    expect(view.shown).toEqual(["browser:__integrated__"]);
    expect(view.starts).toEqual([]);
    view.unmount();
  });

  test("outside the flat-tabs trial, with no browser running it starts one and shows the Browser tab", async () => {
    const pages: [string, boolean][] = [];
    const view = await probe({ bridge: nativeBrowser(pages), flat: false });
    view.onStart(() => pages.push(["n1", true]));
    window.history.replaceState(null, "", sessionHref({ id: "session_1", projectId: "project_1", hostId: "local" }));
    await view.result().openBrowser();
    expect(view.shown).toEqual(["browser:__integrated__"]);
    expect(pages).toEqual([["n1", true]]);
    window.history.replaceState(null, "", "/");
    view.unmount();
  });
});
