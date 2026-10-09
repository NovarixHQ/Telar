import { StackActions, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect } from "react";
import { KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isRegularWidth } from "../../platform/layout";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { hosts, useHosts } from "../hosts";
import { PanelView } from "./PanelView";
import { isPanelTab } from "./tabs";
import { usePanel } from "./use-panel";

/** The panel as a pushed page on iPhone; on iPad a panel link opens the column beside its session instead. */
export function PanelScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Panel">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const insets = useSafeAreaInsets();
  const column = isRegularWidth(useWindowDimensions().width, Platform.OS === "ios" && Platform.isPad);
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const { panel, state } = usePanel(params.hostId, params.sessionId);

  useEffect(() => {
    panel.open(isPanelTab(params.tab) ? params.tab : undefined);
    if (!column) return () => panel.close();
    const { routes } = navigation.getState() ?? { routes: [] };
    const below = routes.at(-2);
    const session = below?.name === "Session" && below.params && "sessionId" in below.params && below.params.sessionId === params.sessionId;
    if (session) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Session", { hostId: params.hostId, sessionId: params.sessionId }));
  }, [panel, params.tab, column]);

  return host && !column ? (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, paddingTop: insets.top, backgroundColor: Theme.canvas }}>
      <PanelView host={host} sessionId={params.sessionId} panel={panel} state={state} onClose={() => navigation.goBack()} />
    </KeyboardAvoidingView>
  ) : null;
}
