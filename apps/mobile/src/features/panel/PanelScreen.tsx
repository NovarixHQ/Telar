import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useLayoutEffect } from "react";
import { useColorScheme } from "react-native";
import type { RootStack } from "../../platform/navigation/routes";
import { palette } from "../../ui";
import { hosts, useHosts } from "../hosts";
import { PanelView } from "./PanelView";
import { isPanelTab, TAB_INFO } from "./tabs";
import { usePanel } from "./use-panel";

/** The panel pushed over a conversation on iPhone. Going back closes it, as in the Swift app. */
export function PanelScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Panel">>();
  const navigation = useNavigation();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const { panel, state } = usePanel(params.hostId, params.sessionId);
  const canvas = palette.canvas[useColorScheme() === "dark" ? "dark" : "light"];

  useEffect(() => {
    panel.open(isPanelTab(params.tab) ? params.tab : undefined);
    return () => panel.close();
  }, [panel, params.tab]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: state.active ? TAB_INFO[state.active].label : "Panel", headerShadowVisible: false, headerStyle: { backgroundColor: canvas } });
  }, [navigation, state.active, canvas]);

  return host ? <PanelView host={host} sessionId={params.sessionId} panel={panel} state={state} /> : null;
}
