"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSidebar } from "@/ui/sidebar";
import { hostFetcher } from "@/platform/engine/host-client";
import { desktopBrowserBridge } from "@/features/browser/desktop-browser-bridge";
import { closeNativePage } from "@/features/browser/native-pages";
import { editorFileForPath, emptyEditor, openInEditor, readEditor, writeEditor, type EditorState, type OpenIntent } from "@/features/files";
import { forgeParams, openForge, readForgeOpen } from "@/features/github";
import {
  activePanelTab,
  addPanelTab,
  browserTabId,
  closePanelTab,
  editorInstanceKey,
  emptyPanelTabs,
  filePanelTabPath,
  findPanelTab,
  isRestorablePanelTab,
  issuePanelNumber,
  movePanelTab,
  nextPanelTabId,
  openNewPanelTab,
  openPanelTab,
  PERSON_CHOICE_MS,
  pullPanelNumber,
  readPanelTabs,
  setPanelTabParams,
  writePanelTabs,
  type PanelTab,
  type PanelTabParams,
  type PanelTabState,
} from "@/features/panel";
import { useBrowserPageTabs } from "./use-browser-page-tabs";
import { createSimulatorsApi, releaseSimulatorTab, SIMULATOR_SURFACE } from "@/features/simulators";
import { closeTerminalTab, createRunApi, unfoldTerminalTabs } from "@/features/terminal";

/** Rail (16rem) + conversation floor (24rem) + panel floor (20rem), rounded up. */
const NARROW_WINDOW = 1280;

type Strip = PanelTabState<PanelTab>;

function restorePanel(panelKey: string): { panel: Strip; editors: Record<string, EditorState> } {
  const panel = unfoldTerminalTabs(readPanelTabs<PanelTab>(panelKey, isRestorablePanelTab), "terminal");
  const editors: Record<string, EditorState> = { editor: readEditor(panelKey) };
  for (const entry of panel.tabs) {
    if (entry.kind === "editor" && !(entry.id in editors)) editors[entry.id] = readEditor(editorInstanceKey(panelKey, entry.id));
  }
  return { panel, editors };
}

function editorTargetId(state: Strip) {
  const active = activePanelTab(state);
  if (active?.kind === "editor") return active.id;
  return state.tabs.find((entry) => entry.kind === "editor")?.id ?? nextPanelTabId(state, "editor");
}

function openForgeTab(current: Strip, kind: "issues" | "pulls", number: number): Strip {
  const opened = openPanelTab(current, kind);
  const target = activePanelTab(opened);
  if (!target) return opened;
  return setPanelTabParams(opened, target.id, forgeParams(openForge(readForgeOpen(target.params), number)));
}

// Outside the reducer: StrictMode runs a reducer twice, and a process must not be killed twice.
function closeTab(panel: Strip, id: string, { hostId, sessionId, updatePanel }: {
  hostId: string;
  sessionId: string | undefined;
  updatePanel: (next: (current: Strip) => Strip) => void;
}) {
  const closing = findPanelTab(panel, id);
  if (closing?.kind === "terminal") {
    const runApi = createRunApi(hostFetcher(hostId));
    void closeTerminalTab(closing.params, {
      ...(sessionId ? { stopRun: (terminalId: string) => runApi.stop(sessionId, terminalId) } : {}),
    }).then((closed) => {
      if (closed) updatePanel((current) => closePanelTab(current, id));
    });
    return;
  }
  if (sessionId && closing?.kind === SIMULATOR_SURFACE) releaseSimulatorTab(createSimulatorsApi(hostId), sessionId, closing.params);
  const pageId = closing ? browserTabId(closing.kind) : undefined;
  const bridge = desktopBrowserBridge();
  if (bridge && sessionId && pageId !== undefined) void closeNativePage(bridge, sessionId, pageId);
  updatePanel((current) => closePanelTab(current, id));
}

function usePersistedPanel(panelKey: string) {
  const [panel, setPanel] = useState<Strip>(() => emptyPanelTabs<PanelTab>());
  const panelNow = useRef(panel);
  const [editors, setEditors] = useState<Record<string, EditorState>>(() => ({}));

  useEffect(() => {
    // Deferred: a synchronous setState in an effect body is a cascading render.
    const task = window.setTimeout(() => {
      const restored = restorePanel(panelKey);
      setEditors(restored.editors);
      panelNow.current = restored.panel;
      setPanel(restored.panel);
    }, 0);
    return () => window.clearTimeout(task);
  }, [panelKey]);

  const updatePanel = useCallback(
    (next: (current: Strip) => Strip) => {
      setPanel((current) => {
        const updated = next(current);
        if (updated === current) return current;
        panelNow.current = updated;
        writePanelTabs(panelKey, updated, Date.now());
        return updated;
      });
    },
    [panelKey],
  );

  const updateEditor = useCallback(
    (id: string, next: (current: EditorState) => EditorState) => {
      setEditors((current) => {
        const updated = next(current[id] ?? emptyEditor());
        writeEditor(editorInstanceKey(panelKey, id), updated, Date.now());
        return { ...current, [id]: updated };
      });
    },
    [panelKey],
  );

  useEffect(() => {
    updatePanel((current) => {
      let next = current;
      for (const entry of current.tabs) {
        if (entry.kind !== "editor" || !(entry.id in editors)) continue;
        const path = editors[entry.id]?.activePath;
        next = setPanelTabParams(next, entry.id, path ? { path } : {});
      }
      return next;
    });
  }, [editors, updatePanel]);

  return { panel, panelNow, updatePanel, editors, updateEditor };
}

/** The right panel's tab strip and Editor instances, persisted per `panelKey`. */
export function useCockpitPanel({ panelKey, enabledPlugins, hostId, sessionId }: {
  panelKey: string;
  enabledPlugins: readonly string[];
  hostId: string;
  sessionId: string | undefined;
}) {
  const { panel, panelNow, updatePanel, editors, updateEditor } = usePersistedPanel(panelKey);

  const { open: railOpen, setOpen: setRailOpen } = useSidebar();
  const makeRoomForPanel = useCallback(() => {
    if (!railOpen) return;
    if (window.innerWidth >= NARROW_WINDOW) return;
    setRailOpen(false);
  }, [railOpen, setRailOpen]);

  // The person's last own move in the panel; what an agent or Run opens waits PERSON_CHOICE_MS behind it.
  const touchedAt = useRef(0);
  const touch = () => {
    touchedAt.current = Date.now();
  };
  const mayReveal = useCallback(() => Date.now() - touchedAt.current >= PERSON_CHOICE_MS, []);
  useBrowserPageTabs(sessionId, updatePanel, mayReveal);

  const presentTab = useCallback(
    (tab: PanelTab, intent: OpenIntent = "pin") => {
      makeRoomForPanel();
      const path = filePanelTabPath(tab);
      if (path !== undefined) {
        // From the committed strip, so the file and the tab that comes forward name the same Editor.
        const target = editorTargetId(panelNow.current);
        updateEditor(target, (current) => openInEditor(current, editorFileForPath(path, enabledPlugins), intent));
        updatePanel((current) => openPanelTab(current, "editor"));
        return;
      }
      const issue = issuePanelNumber(tab);
      const pull = issue === undefined ? pullPanelNumber(tab) : undefined;
      if (issue !== undefined) return updatePanel((current) => openForgeTab(current, "issues", issue));
      if (pull !== undefined) return updatePanel((current) => openForgeTab(current, "pulls", pull));
      updatePanel((current) => openPanelTab(current, tab));
    },
    [makeRoomForPanel, updatePanel, updateEditor, enabledPlugins, panelNow],
  );

  const showPanelTab = useCallback(
    (tab: PanelTab, intent: OpenIntent = "pin") => {
      touch();
      presentTab(tab, intent);
    },
    [presentTab],
  );

  const revealSurface = useCallback(
    (tab: PanelTab) => {
      if (mayReveal()) presentTab(tab);
    },
    [mayReveal, presentTab],
  );

  const openFileInNewPanelTab = useCallback(
    (path: string) => {
      touch();
      makeRoomForPanel();
      const id = nextPanelTabId(panelNow.current, "editor");
      updateEditor(id, (current) => openInEditor(current, editorFileForPath(path, enabledPlugins), "pin"));
      updatePanel((current) => addPanelTab(current, { id, kind: "editor", params: { path } }));
    },
    [makeRoomForPanel, updatePanel, updateEditor, enabledPlugins, panelNow],
  );

  const showNewPanelTab = useCallback(
    (tab: PanelTab, params?: PanelTabParams) => {
      touch();
      makeRoomForPanel();
      updatePanel((current) => openNewPanelTab(current, tab, params));
    },
    [makeRoomForPanel, updatePanel],
  );

  const stepPanelTab = useCallback(
    (delta: number) => {
      const { tabs, activeTab } = panelNow.current;
      const at = Math.max(tabs.findIndex((entry) => entry.id === activeTab), 0);
      const next = tabs[(at + delta + tabs.length) % tabs.length];
      touch();
      if (next) updatePanel((state) => ({ ...state, activeTab: next.id, open: true }));
    },
    [updatePanel, panelNow],
  );

  const setOpen = (open: boolean) => {
    touch();
    if (open) makeRoomForPanel();
    updatePanel((current) => ({ ...current, open }));
  };

  const tabHandlers = {
    onTabChange: (id: string) => {
      touch();
      updatePanel((current) => ({ ...current, activeTab: id }));
    },
    onCloseTab: (id: string) => {
      touch();
      closeTab(panel, id, { hostId, sessionId, updatePanel });
    },
    onTabParams: (id: string, params: PanelTabParams) => updatePanel((current) => setPanelTabParams(current, id, params)),
    onMoveTab: (id: string, toIndex: number) => {
      touch();
      updatePanel((current) => movePanelTab(current, id, toIndex));
    },
  };

  return {
    panel, editors, updatePanel, updateEditor, showPanelTab, revealSurface, mayReveal, openFileInNewPanelTab, showNewPanelTab, stepPanelTab,
    openPanel: () => setOpen(true), togglePanel: () => setOpen(!panelNow.current.open), tabHandlers,
  };
}
