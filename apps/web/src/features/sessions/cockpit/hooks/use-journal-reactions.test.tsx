import { expect, test } from "bun:test";
import { act, useState } from "react";
import type { EngineEvent, SimulatorSummary } from "@telar/engine-client";
import { emptyPanelTabs, LIVE_BROWSER_TAB, type PanelTabState } from "@/features/panel";
import { flush, installTestDom, mount } from "@/test/dom";
import { useJournalReactions } from "./use-journal-reactions";

installTestDom();

type Strip = PanelTabState<string>;
const iPhone = (id: string): SimulatorSummary => ({ id, platform: "ios", name: `iPhone ${id}`, version: "iOS 18.0", booted: true, physical: false });

function harness(initial: Strip) {
  let strip = initial;
  let push: (events: EngineEvent[]) => void = () => undefined;
  function Probe() {
    const [events, setEvents] = useState<EngineEvent[]>([]);
    const [panel, setPanel] = useState(initial);
    push = setEvents;
    strip = panel;
    useJournalReactions({
      sessionId: "s",
      sync: { events } as never,
      browser: undefined,
      enabledPlugins: [],
      panel: { showPanelTab: () => undefined, updatePanel: (next: (current: Strip) => Strip) => setPanel((current) => next(current)) } as never,
    });
    return null;
  }
  return { Probe, strip: () => strip, push: (events: EngineEvent[]) => act(async () => push(events)) };
}

const later = () => Date.now() + 60_000;
const opened = (id: number, simulator: string) => ({ id, at: later(), sessionId: "s", type: "simulator.opened", simulator: iPhone(simulator) }) as unknown as EngineEvent;
const closed = (id: number, simulator: string) => ({ id, at: later(), sessionId: "s", type: "simulator.closed", simulatorId: simulator }) as unknown as EngineEvent;

test("a simulator the agent opens opens the Simulator tab on it, and closing it drops it from that tab", async () => {
  const { Probe, strip, push } = harness(emptyPanelTabs());
  await mount(<Probe />);
  await push([opened(1, "A")]);
  await flush();
  expect(strip().open).toBe(true);
  expect(strip().tabs).toEqual([{ id: "simulator", kind: "simulator", params: { open: "A", active: "A" } }]);
  expect(strip().activeTab).toBe("simulator");

  await push([opened(1, "A"), opened(2, "B")]);
  await flush();
  expect(strip().tabs[0]!.params).toEqual({ open: "A,B", active: "B" });

  await push([opened(1, "A"), opened(2, "B"), closed(3, "B")]);
  await flush();
  expect(strip().tabs[0]!.params).toEqual({ open: "A", active: "" });
});

test("events from before the cockpit mounted do nothing, so reopening a session does not reopen its simulators", async () => {
  const { Probe, strip, push } = harness(emptyPanelTabs());
  await mount(<Probe />);
  await push([{ ...(opened(1, "A") as object), at: 1 } as EngineEvent]);
  await flush();
  expect(strip().tabs).toEqual([]);
});

const browsed = (id: number) => ({ id, at: later(), sessionId: "s", type: "browser.state.changed", tabs: [{ id: "t1", url: "https://example.com/" }] }) as unknown as EngineEvent;

function withDesktopBrowser(popped: boolean) {
  const asked: string[] = [];
  (window as { telarDesktop?: unknown }).telarDesktop = {
    browser: { getState: async (scope: string) => { asked.push(scope); return { scopeKey: scope, tabs: [], popped }; } },
  };
  return asked;
}

test("the agent browsing adds the Browser tab to the panel", async () => {
  withDesktopBrowser(false);
  const { Probe, strip, push } = harness(emptyPanelTabs());
  await mount(<Probe />);
  await push([browsed(1)]);
  await flush();
  expect(strip().tabs).toEqual([{ id: LIVE_BROWSER_TAB, kind: LIVE_BROWSER_TAB, params: {} }]);
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});

test("but not while that browser is in a window of its own", async () => {
  const asked = withDesktopBrowser(true);
  const { Probe, strip, push } = harness(emptyPanelTabs());
  await mount(<Probe />);
  await push([browsed(1)]);
  await flush();
  expect(asked).toEqual(["s"]);
  expect(strip().tabs).toEqual([]);
  delete (window as { telarDesktop?: unknown }).telarDesktop;
});
