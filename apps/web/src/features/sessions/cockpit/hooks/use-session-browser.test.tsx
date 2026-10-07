import { describe, expect, test } from "bun:test";
import type { EngineEvent } from "@telar/engine-client";
import type { DesktopBrowserBridge } from "@/features/browser/types";
import { flush, installTestDom, mount, stubFetch } from "@/test/dom";
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

const pageEvent = (ids: string[]) =>
  ({ id: 1, at: 1, sessionId: "session_1", type: "browser.state.changed", provider: "integrated", tabs: ids.map((id) => ({ id, title: id, url: `https://${id}.test/` })) }) as unknown as EngineEvent;

async function probe({ sessionId = "session_1", bridge, events = [], canStart = true }: { sessionId?: string; bridge?: DesktopBrowserBridge; events?: EngineEvent[]; canStart?: boolean }) {
  withBridge(bridge);
  const starts: string[] = [];
  stubFetch({
    "GET /api/sessions/session_1/browser": () => ({ browser: { scopeKey: "session_1", provider: "none", running: false, tabs: [], canStart } }),
    "POST /api/sessions/session_1/browser": () => {
      starts.push("start");
      return { browser: { scopeKey: "session_1", provider: "integrated", running: true, tabs: [], canStart } };
    },
  });
  const shown: string[] = [];
  const panel = { showSessionBrowser: () => shown.push("live"), showPanelTab: (tab: string) => shown.push(tab) };
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

  test("in the desktop app it shows the live browser instead", async () => {
    const view = await probe({ bridge: {} as DesktopBrowserBridge, events: [pageEvent(["a"])] });
    await view.result().openBrowser();
    expect(view.shown).toEqual(["live"]);
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
});
