import { useEffect, useRef, useState } from "react";
import { Platform, Settings, useWindowDimensions } from "react-native";
import { isRegularWidth, useSplitColumn } from "../../platform/layout";
import { PANEL_WIDTH_KEY, panelWidthOf, standsAside } from "./panel-width";
import type { PanelTab } from "./tabs";
import { usePanel } from "./use-panel";

export function usePanelColumn(hostId: string, sessionId: string, push: (tab?: PanelTab) => void) {
  const { panel, state } = usePanel(hostId, sessionId);
  const window = useWindowDimensions().width;
  const wantsColumn = isRegularWidth(window, Platform.OS === "ios" && Platform.isPad);
  const [width, setWidth] = useState(() => panelWidthOf(Settings.get(PANEL_WIDTH_KEY)));
  const split = useSplitColumn();
  const stoodAside = useRef(false);

  const aside = wantsColumn && standsAside(state.isOpen, state.fullScreen, window, width);
  useEffect(() => {
    if (aside && !split.sidebarHidden) {
      stoodAside.current = true;
      split.setSidebarHidden(true);
    } else if (!aside && stoodAside.current) {
      stoodAside.current = false;
      split.setSidebarHidden(false);
    }
  }, [aside]);
  const latest = useRef(split);
  latest.current = split;
  useEffect(() => () => {
    if (stoodAside.current) latest.current.setSidebarHidden(false);
  }, []);

  return {
    panel,
    state,
    wantsColumn,
    shown: wantsColumn && state.isOpen,
    width,
    setWidth: (next: number) => {
      setWidth(next);
      Settings.set({ [PANEL_WIDTH_KEY]: next });
    },
    toggle: (tab?: PanelTab) => {
      if (!wantsColumn) return push(tab);
      if (state.isOpen && !tab) panel.close();
      else panel.open(tab);
    },
  };
}
