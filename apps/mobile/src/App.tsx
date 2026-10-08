import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Button, Linking, Settings, useColorScheme } from "react-native";
import { hosts, HostsScreen, PairScreen } from "./features/hosts";
import { PanelScreen } from "./features/panel";
import { SessionScreen, SessionsScreen } from "./features/sessions";
import type { RootStack } from "./platform/navigation/routes";
import { navigationTheme } from "./platform/navigation/theme";

const Stack = createNativeStackNavigator<RootStack>();

// `-telarOpenURL <telar://…>` at launch opens that link without iOS's confirmation, which a simulator cannot tap.
async function initialUrl(): Promise<string | null | undefined> {
  const url: unknown = Settings.get("telarOpenURL");
  return typeof url === "string" && url.startsWith("telar://") ? url : Linking.getInitialURL();
}

const linking: LinkingOptions<RootStack> = { prefixes: ["telar://"], config: { screens: { Pair: "pair", Sessions: "host/:hostId", Session: "session/:hostId/:sessionId", Panel: "panel/:hostId/:sessionId/:tab?" } }, getInitialURL: initialUrl };

export function App() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <NavigationContainer linking={linking} theme={navigationTheme(scheme)}>
      <StatusBar style="auto" />
      <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
        <Stack.Screen name="Hosts" component={HostsScreen} options={{ title: "Telar" }} />
        <Stack.Screen name="Pair" component={PairScreen} options={{ title: "Pair a computer", presentation: "formSheet", headerLargeTitle: false, sheetAllowedDetents: [0.6, 1] }} />
        <Stack.Screen name="Sessions" component={SessionsScreen} options={({ route }) => ({ title: route.params.hostName ?? hosts.get(route.params.hostId)?.name ?? "Sessions" })} />
        <Stack.Screen
          name="Session"
          component={SessionScreen}
          options={({ route, navigation }) => ({
            title: route.params.title ?? "",
            headerLargeTitle: false,
            headerRight: () => (
              <Button title="Panel" onPress={() => navigation.navigate("Panel", { hostId: route.params.hostId, sessionId: route.params.sessionId })} />
            ),
          })}
        />
        <Stack.Screen name="Panel" component={PanelScreen} options={{ title: "Panel", headerLargeTitle: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
