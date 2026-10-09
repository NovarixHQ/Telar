import { NavigationContainer, useNavigationContainerRef, type LinkingOptions } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Button, Linking, Settings, useColorScheme } from "react-native";
import { ConnectScreen } from "./features/hosts";
import { AddProjectScreen } from "./features/projects";
import { PanelScreen } from "./features/panel";
import { launchLink, onNotificationLink, startLiveActivityCard, startPush } from "./features/push";
import { NewSessionScreen, ProjectPickerScreen, RailScreen, refreshInbox, SessionScreen } from "./features/sessions";
import { SettingsScreen } from "./features/settings";
import { UsageScreen } from "./features/usage";
import { createSplitStackNavigator, DetailPlaceholder } from "./platform/layout";
import type { RootStack } from "./platform/navigation/routes";
import { navigationTheme } from "./platform/navigation/theme";

const Stack = createSplitStackNavigator<RootStack>();

// `-telarOpenURL <telar://…>` at launch opens that link without iOS's confirmation, which a simulator cannot tap.
async function initialUrl(): Promise<string | null | undefined> {
  const url: unknown = Settings.get("telarOpenURL");
  return typeof url === "string" && url.startsWith("telar://") ? url : (launchLink() ?? Linking.getInitialURL());
}

function subscribe(listener: (url: string) => void): () => void {
  const opened = Linking.addEventListener("url", ({ url }) => listener(url));
  const tapped = onNotificationLink(listener);
  return () => {
    opened.remove();
    tapped();
  };
}

const linking: LinkingOptions<RootStack> = {
  prefixes: ["telar://"],
  config: { initialRouteName: "Rail", screens: { Pair: "pair", Session: "session/:hostId/:sessionId", Panel: "panel/:hostId/:sessionId/:tab?" } },
  getInitialURL: initialUrl,
  subscribe,
};

startPush();

export function App() {
  const navigation = useNavigationContainerRef<RootStack>();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  useEffect(() => startLiveActivityCard(), []);
  return (
    <NavigationContainer ref={navigation} linking={linking} theme={navigationTheme(scheme)}>
      <StatusBar style="auto" />
      <Stack.Navigator
        initialRouteName="Rail"
        selection={["Session", "NewSession"]}
        placeholder={<DetailPlaceholder onNewSession={() => navigation.navigate("NewSession")} />}
        screenOptions={{ headerLargeTitle: true }}
      >
        <Stack.Screen name="Rail" component={RailScreen} options={{ title: "Telar" }} />
        <Stack.Screen name="Pair" component={ConnectScreen} options={{ title: "Connect to Telar", headerLargeTitle: false, headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="NewSession" component={NewSessionScreen} options={{ title: "New session", headerLargeTitle: false, headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen
          name="ProjectPicker"
          component={ProjectPickerScreen}
          options={({ navigation }) => ({ title: "Project", presentation: "formSheet", sheetAllowedDetents: [0.5, 1], headerLargeTitle: false, headerLeft: () => <Button title="Close" onPress={() => navigation.goBack()} /> })}
        />
        <Stack.Screen name="AddProject" options={{ presentation: "modal", headerShown: false }}>
          {({ navigation, route }) => (
            <AddProjectScreen
              hostId={route.params.hostId}
              onCancel={() => navigation.goBack()}
              onAdded={(project) =>
                void refreshInbox(route.params.hostId).finally(() =>
                  route.params.pick ? navigation.popTo("NewSession", { hostId: route.params.hostId, projectId: project.id }, { merge: true }) : navigation.goBack(),
                )
              }
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Session" component={SessionScreen} options={({ route }) => ({ title: route.params.title ?? "Session", headerLargeTitle: false, headerTransparent: true, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal" })} />
        <Stack.Screen name="Panel" component={PanelScreen} options={{ title: "Panel", headerShown: false }} />
        <Stack.Screen name="Settings" options={{ presentation: "modal", headerShown: false }}>
          {({ navigation }) => <SettingsScreen onDone={() => navigation.goBack()} onUsage={() => navigation.navigate("Usage")} />}
        </Stack.Screen>
        <Stack.Screen name="Usage" options={{ presentation: "modal", headerShown: false }}>
          {({ navigation, route }) => <UsageScreen {...(route.params?.hostId ? { hostId: route.params.hostId } : {})} onDone={() => navigation.goBack()} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
