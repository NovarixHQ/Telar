"use client";

import { useCommandHandlers } from "@/features/commands";
import { surfaceCommands } from "@/features/panel";
import type { useCockpitPanel } from "./use-cockpit-panel";

/** The cockpit's keyboard commands: the panel's (none on the solo route), one opener per surface, and pinning. */
export function useCockpitCommands({ solo, enabledPlugins, panel, openBrowser, pinSession }: {
  solo: boolean;
  enabledPlugins: readonly string[];
  panel: ReturnType<typeof useCockpitPanel>;
  openBrowser: () => void;
  pinSession: () => void;
}) {
  const { togglePanel, stepPanelTab, showPanelTab } = panel;
  useCommandHandlers(
    {
      ...(solo
        ? {}
        : {
            "toggle-panel": togglePanel,
            "panel-next-tab": () => stepPanelTab(1),
            "panel-previous-tab": () => stepPanelTab(-1),
            "open-browser": openBrowser,
            ...Object.fromEntries(surfaceCommands(enabledPlugins).map(({ command, tab }) => [command, () => showPanelTab(tab)])),
          }),
      "pin-session": pinSession,
    },
    [solo, enabledPlugins],
  );
}
