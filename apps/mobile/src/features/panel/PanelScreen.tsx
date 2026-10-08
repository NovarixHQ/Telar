import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { hosts, useHosts } from "../hosts";
import { PanelView } from "./PanelView";
import { isPanelTab } from "./tabs";
import { usePanel } from "./use-panel";

export function PanelScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Panel">>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const { panel, state } = usePanel(params.hostId, params.sessionId);

  useEffect(() => {
    panel.open(isPanelTab(params.tab) ? params.tab : undefined);
    return () => panel.close();
  }, [panel, params.tab]);

  return host ? (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: Theme.canvas }}>
      <PanelView host={host} sessionId={params.sessionId} panel={panel} state={state} onClose={() => navigation.goBack()} />
    </View>
  ) : null;
}
