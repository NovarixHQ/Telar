import { beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { writePanelTabs, type PanelTab, type PanelTabState } from "@/features/panel";
import { setExperiment } from "@/features/settings/experiments";
import { SidebarProvider } from "@/ui/sidebar";
import { flush, installTestDom, mount } from "@/test/dom";
import { useCockpitPanel } from "./use-cockpit-panel";

installTestDom();

beforeEach(() => window.localStorage.clear());

type Strip = PanelTabState<PanelTab>;
const shell = (terminal: string) => ({ terminal });
const saved: Strip = {
  tabs: [
    { id: "terminal", kind: "terminal", params: shell("pty_1") },
    { id: "diff", kind: "diff", params: {} },
    { id: "terminal#2", kind: "terminal", params: shell("pty_2") },
  ],
  activeTab: "terminal#2",
  open: true,
};

async function restore(stored: Strip) {
  writePanelTabs("session_a", stored, 1);
  let panel: Strip = { tabs: [], open: false };
  function Probe() {
    panel = useCockpitPanel({ panelKey: "session_a", enabledPlugins: [], hostId: "local", sessionId: "session_a" }).panel;
    return null;
  }
  await mount(
    <SidebarProvider>
      <Probe />
    </SidebarProvider>,
  );
  await flush(() => panel.tabs.length > 0);
  return () => panel;
}

const terminals = (panel: Strip) =>
  panel.tabs.flatMap((tab) => (tab.kind !== "terminal" ? [] : tab.params.shells ? (JSON.parse(tab.params.shells).shells as { terminalId?: string }[]).map((one) => one.terminalId) : [tab.params.terminal]));

test("with the trial off, saved Terminal tabs restore folded into one, every shell kept, the active one selected", async () => {
  const panel = await restore(saved);
  expect(panel().tabs.map((tab) => tab.id)).toEqual(["terminal", "diff"]);
  expect(terminals(panel())).toEqual(["pty_1", "pty_2"]);
  expect(panel().activeTab).toBe("terminal");
  expect(JSON.parse(panel().tabs[0]!.params.shells!).active).toBe("shell#2");
});

test("with the trial on, a saved strip restores as one tab per shell", async () => {
  const folded = (await restore(saved))();
  window.localStorage.clear();
  await act(async () => setExperiment("flat-panel-tabs", true));
  const panel = await restore(folded);
  expect(panel().tabs.map((tab) => tab.id)).toEqual(["terminal", "terminal#2", "diff"]);
  expect(terminals(panel())).toEqual(["pty_1", "pty_2"]);
  expect(panel().activeTab).toBe("terminal#2");
});

test("turning the trial on and off while the cockpit is open unfolds and folds the live strip", async () => {
  const panel = await restore(saved);
  await act(async () => setExperiment("flat-panel-tabs", true));
  await flush();
  expect(panel().tabs.map((tab) => tab.kind)).toEqual(["terminal", "terminal", "diff"]);
  expect(terminals(panel())).toEqual(["pty_1", "pty_2"]);
  await act(async () => setExperiment("flat-panel-tabs", false));
  await flush();
  expect(panel().tabs.map((tab) => tab.kind)).toEqual(["terminal", "diff"]);
  expect(terminals(panel())).toEqual(["pty_1", "pty_2"]);
});
