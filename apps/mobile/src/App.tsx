import { NavigationContainer, useNavigationContainerRef, type LinkingOptions } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Button, Linking, Settings, useColorScheme } from "react-native";
import { ConnectScreen } from "./features/hosts";
import { PanelScreen } from "./features/panel";
import { launchLink, onNotificationLink, startLiveActivityCard, startPush } from "./features/push";
import { RailScreen, SessionScreen } from "./features/sessions";
import { SettingsScreen } from "./features/settings";
import { UsageScreen } from "./features/usage";
import { createSplitStackNavigator, DetailPlaceholder } from "./platform/layout";
import type { RootStack } from "./platform/navigation/routes";
import { navigationTheme } from "./platform/navigation/theme";
import { Unavailable } from "./platform/navigation/Unavailable";

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
        selection={["Session"]}
        placeholder={<DetailPlaceholder onNewSession={() => navigation.navigate("Unavailable", { title: "New session", systemImage: "square.and.pencil" })} />}
        screenOptions={{ headerLargeTitle: true }}
      >
        <Stack.Screen name="Rail" component={RailScreen} options={{ title: "Telar" }} />
        <Stack.Screen name="Pair" component={ConnectScreen} options={{ title: "Connect to Telar", headerLargeTitle: false, headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Group screenOptions={({ navigation }) => ({ presentation: "modal", headerLargeTitle: false, headerRight: () => <Button title="Done" onPress={() => navigation.goBack()} /> })}>
          <Stack.Screen name="Unavailable" component={Unavailable} options={({ route }) => ({ title: route.params.title })} />
        </Stack.Group>
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
