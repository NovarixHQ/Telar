import { expect, test } from "bun:test";
import { act, useState } from "react";
import type { EngineEvent, SimulatorSummary } from "@telar/engine-client";
import type { RunView } from "@/features/terminal";
import { emptyPanelTabs, type PanelTabState } from "@/features/panel";
import { flush, installTestDom, mount } from "@/test/dom";
import { useJournalReactions } from "./use-journal-reactions";

installTestDom();

type Strip = PanelTabState<string>;
const iPhone = (id: string): SimulatorSummary => ({ id, platform: "ios", name: `iPhone ${id}`, version: "iOS 18.0", booted: true, physical: false });

function harness(initial: Strip, { touched = false }: { touched?: boolean } = {}) {
  let strip = initial;
  let push: (events: EngineEvent[]) => void = () => undefined;
  let report: (terminals: readonly RunView[]) => void = () => undefined;
  function Probe() {
    const [events, setEvents] = useState<EngineEvent[]>([]);
    const [panel, setPanel] = useState(initial);
    push = setEvents;
    strip = panel;
    report = useJournalReactions({
      sync: { events } as never,
      browser: undefined,
      enabledPlugins: [],
      panel: { revealSurface: () => undefined, mayReveal: () => !touched, updatePanel: (next: (current: Strip) => Strip) => setPanel((current) => next(current)) } as never,
    });
    return null;
  }
  return {
    Probe,
    strip: () => strip,
    push: (events: EngineEvent[]) => act(async () => push(events)),
    runs: (terminals: readonly RunView[]) => act(async () => report(terminals)),
  };
}

const run = (runId: string, activity: "idle" | "busy" = "idle", command = ""): RunView =>
  ({ runId, terminalId: runId, status: "ready", activity, command, title: runId, startedAt: 1 }) as unknown as RunView;

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

test("the agent's simulator is added but not shown while the person's own choice is recent", async () => {
  const { Probe, strip, push } = harness({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: false }, { touched: true });
  await mount(<Probe />);
  await push([opened(1, "A")]);
  await flush();
  expect(strip().tabs.map((tab) => tab.id)).toEqual(["diff", "simulator"]);
  expect(strip().activeTab).toBe("diff");
  expect(strip().open).toBe(false);
});

test("terminals already running when the cockpit opens get tabs without taking the panel", async () => {
  const { Probe, strip, runs } = harness({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: false });
  await mount(<Probe />);
  await runs([run("t1", "busy", "bun dev")]);
  expect(strip().tabs.map((tab) => tab.kind)).toEqual(["diff", "terminal"]);
  expect(strip().activeTab).toBe("diff");
  expect(strip().open).toBe(false);
});

test("a terminal opened later opens the panel on its tab", async () => {
  const { Probe, strip, runs } = harness({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: false });
  await mount(<Probe />);
  await runs([]);
  await runs([run("t1")]);
  expect(strip().open).toBe(true);
  expect(strip().activeTab).toBe("terminal");
});

test("a command typed into an existing shell brings its tab forward", async () => {
  const { Probe, strip, runs } = harness({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: true });
  await mount(<Probe />);
  await runs([run("t1")]);
  expect(strip().activeTab).toBe("diff");
  await runs([run("t1", "busy", "bun test")]);
  expect(strip().activeTab).toBe("terminal");
});

test("the person's recent choice wins over a new terminal: it is added, not shown", async () => {
  const { Probe, strip, runs } = harness({ tabs: [{ id: "diff", kind: "diff", params: {} }], activeTab: "diff", open: true }, { touched: true });
  await mount(<Probe />);
  await runs([]);
  await runs([run("t1", "busy", "bun dev")]);
  expect(strip().tabs.map((tab) => tab.kind)).toEqual(["diff", "terminal"]);
  expect(strip().activeTab).toBe("diff");
});
