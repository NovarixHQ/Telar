"use client";

import { useCommandHandlers } from "@/features/commands";
import { surfaceCommands } from "@/features/panel";
import type { PluginPanelSource } from "@/features/plugins";
import { useCanOpenShells } from "@/features/terminal";
import type { useCockpitPanel } from "./use-cockpit-panel";
import { useWorkspaceCardOpen } from "./use-workspace-card";

const PANEL_TAB_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The cockpit's keyboard commands: the panel's and the Workspace card's (none on the solo route), one opener per surface, and pinning. */
export function useCockpitCommands({ solo, pluginPanels, panel, openBrowser, pinSession }: {
  solo: boolean;
  pluginPanels: readonly PluginPanelSource[];
  panel: ReturnType<typeof useCockpitPanel>;
  openBrowser: () => void;
  pinSession: () => void;
}) {
  const { togglePanel, stepPanelTab, selectPanelTab, showPanelTab, closeActivePanelTab } = panel;
  const toggleWorkspace = useWorkspaceCardOpen().toggle;
  const shells = useCanOpenShells();
  useCommandHandlers(
    {
      ...(solo
        ? {}
        : {
            "toggle-panel": togglePanel,
            "panel-next-tab": () => stepPanelTab(1),
            "panel-previous-tab": () => stepPanelTab(-1),
            "close-panel-tab": closeActivePanelTab,
            ...Object.fromEntries(PANEL_TAB_SLOTS.map((slot) => [`panel-tab-${slot}`, () => selectPanelTab(slot)])),
            "open-browser": openBrowser,
            "toggle-workspace": toggleWorkspace,
            ...Object.fromEntries(surfaceCommands({ shells, pluginPanels }).map(({ command, tab }) => [command, () => showPanelTab(tab)])),
          }),
      "pin-session": pinSession,
    },
    [solo, pluginPanels, shells],
  );
}
