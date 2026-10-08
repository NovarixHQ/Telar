import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Button, Linking, Settings, useColorScheme } from "react-native";
import { DiffScreen } from "./features/git";
import { ConnectScreen, HostSettingsScreen, HostsScreen } from "./features/hosts";
import { RailScreen, SessionScreen } from "./features/sessions";
import type { RootStack } from "./platform/navigation/routes";
import { navigationTheme } from "./platform/navigation/theme";
import { Unavailable } from "./platform/navigation/Unavailable";

const Stack = createNativeStackNavigator<RootStack>();

// `-telarOpenURL <telar://…>` at launch opens that link without iOS's confirmation, which a simulator cannot tap.
async function initialUrl(): Promise<string | null | undefined> {
  const url: unknown = Settings.get("telarOpenURL");
  return typeof url === "string" && url.startsWith("telar://") ? url : Linking.getInitialURL();
}

const linking: LinkingOptions<RootStack> = { prefixes: ["telar://"], config: { initialRouteName: "Rail", screens: { Pair: "pair", Session: "session/:hostId/:sessionId", Diff: "diff/:hostId/:sessionId" } }, getInitialURL: initialUrl };

export function App() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <NavigationContainer linking={linking} theme={navigationTheme(scheme)}>
      <StatusBar style="auto" />
      <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
        <Stack.Screen name="Rail" component={RailScreen} options={{ title: "Telar" }} />
        <Stack.Screen name="Pair" component={ConnectScreen} options={{ title: "Connect to Telar", headerLargeTitle: false, headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Group screenOptions={({ navigation }) => ({ presentation: "modal", headerLargeTitle: false, headerRight: () => <Button title="Done" onPress={() => navigation.goBack()} /> })}>
          <Stack.Screen name="Settings" component={HostsScreen} options={{ title: "Settings" }} />
          <Stack.Screen name="Unavailable" component={Unavailable} options={({ route }) => ({ title: route.params.title })} />
        </Stack.Group>
        <Stack.Screen name="HostSettings" component={HostSettingsScreen} options={{ title: "Computer", headerLargeTitle: false, headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="Session" component={SessionScreen} options={({ route }) => ({ title: route.params.title ?? "Session", headerLargeTitle: false, headerTransparent: true, headerShadowVisible: false, headerBackButtonDisplayMode: "minimal" })} />
        <Stack.Screen name="Diff" component={DiffScreen} options={{ title: "Diff", headerLargeTitle: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
