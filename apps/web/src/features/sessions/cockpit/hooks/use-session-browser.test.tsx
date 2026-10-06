import { describe, expect, test } from "bun:test";
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

async function canStartFor(sessionId: string | undefined, bridge: DesktopBrowserBridge | undefined): Promise<boolean> {
  withBridge(bridge);
  stubFetch({ "GET /api/sessions/session_1/browser": () => ({ browser: { scopeKey: "session_1", provider: "none", running: false, tabs: [], canStart: true } }) });
  let result: ReturnType<typeof useSessionBrowser> | undefined;
  function Probe() {
    result = useSessionBrowser({
      hostId: "local",
      sessionId,
      projectId: "project_1",
      sync: { transcriptLanded: true, events: [], setSession: () => {} } as never,
      draft,
      composer: {} as never,
      panel: {} as never,
      setCreatedSessionId: () => {},
    });
    return null;
  }
  const { unmount } = await mount(<Probe />);
  await flush(() => result!.browserCanStart || true);
  await flush();
  const value = result!.browserCanStart;
  unmount();
  withBridge(undefined);
  return value;
}

describe("whether a client can start the session's browser", () => {
  test("an existing session can start one with the desktop bridge", async () => {
    expect(await canStartFor("session_1", {} as DesktopBrowserBridge)).toBe(true);
  });

  test("an existing session cannot start one without the desktop bridge", async () => {
    expect(await canStartFor("session_1", undefined)).toBe(false);
  });

  test("a fresh draft can start one with the desktop bridge", async () => {
    expect(await canStartFor(undefined, {} as DesktopBrowserBridge)).toBe(true);
  });

  test("a fresh draft cannot start one without the desktop bridge", async () => {
    expect(await canStartFor(undefined, undefined)).toBe(false);
  });
});
