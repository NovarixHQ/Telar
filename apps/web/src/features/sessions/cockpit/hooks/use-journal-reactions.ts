"use client";

import { useCallback, useEffect, useRef } from "react";
import { announcePromptShelfChanged } from "@/features/prompts";
import { browserPanelTab, panelTabForPath, revealPanelTab, setPanelTabParams, type latestBrowserState } from "@/features/panel";
import { sessionSimulatorChanges, SIMULATOR_SURFACE, withSimulatorDropped } from "@/features/simulators";
import { isOpenTerminal, revealGroupedTerminal, revealTerminal, startedCommand, syncGroupedRuns, syncRunTabs, type RunView } from "@/features/terminal";
import { desktopBrowserBridge } from "@/features/browser/desktop-browser-bridge";
import { showSimulatorTab } from "../model";
import type { useCockpitPanel } from "./use-cockpit-panel";
import type { useSessionSync } from "./use-session-sync";

/** What the panel does when the journal says the agent opened a page, a display, a terminal or a prompt draft, or anyone opened a simulator in this session. */
export function useJournalReactions({ sync: { events }, browser, enabledPlugins, panel: { revealSurface, mayReveal, updatePanel, flat } }: {
  sync: ReturnType<typeof useSessionSync>;
  browser: ReturnType<typeof latestBrowserState>;
  enabledPlugins: readonly string[];
  panel: ReturnType<typeof useCockpitPanel>;
}) {
  const seenPages = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (desktopBrowserBridge()) return;
    const pages = browser?.tabs ?? [];
    const fresh = pages.filter((page) => !seenPages.current.has(page.id));
    for (const page of pages) seenPages.current.add(page.id);
    if (fresh.length === 0) return;
    const show = mayReveal();
    updatePanel((current) => fresh.reduce((state, page) => revealPanelTab(state, { id: browserPanelTab(page.id), kind: browserPanelTab(page.id), params: {} }, show), current));
  }, [browser, updatePanel, mayReveal]);

  // Stamped in an effect, not at render: reading the clock during render is impure.
  const mountedAt = useRef(0);
  const seenEvents = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (mountedAt.current === 0) mountedAt.current = Date.now();
    const fresh = events.filter(
      (event) => (event.type === "display.opened" || event.type === "prompt.drafted") && event.at >= mountedAt.current && !seenEvents.current.has(event.id),
    );
    for (const event of fresh) seenEvents.current.add(event.id);
    const display = fresh.filter((event) => event.type === "display.opened").at(-1);
    if (display?.type === "display.opened") revealSurface(panelTabForPath(display.path, enabledPlugins));
    if (fresh.some((event) => event.type === "prompt.drafted")) announcePromptShelfChanged();
    for (const change of sessionSimulatorChanges(events, mountedAt.current, seenEvents.current)) {
      updatePanel((current) => {
        if ("shown" in change) return showSimulatorTab(current, change.shown, mayReveal());
        return current.tabs
          .filter((tab) => tab.kind === SIMULATOR_SURFACE)
          .reduce((state, tab) => setPanelTabParams(state, tab.id, withSimulatorDropped(tab.params, change.dropped)), current);
      });
    }
  }, [events, enabledPlugins, revealSurface, mayReveal, updatePanel]);

  // Every open run gets a tab once; a run whose tab the person closed is not brought back by the frame reporting the close.
  const seenTerminals = useRef<Set<string>>(new Set());
  const previous = useRef<Map<string, RunView> | undefined>(undefined);
  return useCallback(
    (terminals: readonly RunView[]) => {
      const before = previous.current;
      previous.current = new Map(terminals.map((run) => [run.runId, run]));
      const fresh = terminals.filter((run) => isOpenTerminal(run) && !seenTerminals.current.has(run.terminalId)).reverse();
      for (const run of terminals) seenTerminals.current.add(run.terminalId);
      const started = before ? terminals.filter((run) => isOpenTerminal(run) && startedCommand(run, before.get(run.runId))).reverse() : [];
      const show = before !== undefined && mayReveal();
      const [sync, reveal] = flat ? [syncRunTabs, revealTerminal] : [syncGroupedRuns, revealGroupedTerminal];
      updatePanel((current) => {
        const synced = sync(current, terminals, "terminal", { dropMissing: before === undefined });
        const added = fresh.reduce((state, run) => reveal(state, run, "terminal", show), synced);
        return show ? started.reduce((state, run) => reveal(state, run, "terminal", true), added) : added;
      });
    },
    [updatePanel, mayReveal, flat],
  );
}
