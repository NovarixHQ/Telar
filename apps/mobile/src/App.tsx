import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Linking, Settings } from "react-native";
import { HostsScreen, PairScreen } from "./features/hosts";
import { SessionScreen, SessionsScreen } from "./features/sessions";
import type { RootStack } from "./platform/navigation/routes";

const Stack = createNativeStackNavigator<RootStack>();

// `-telarOpenURL <telar://…>` at launch opens that link without iOS's confirmation, which a simulator cannot tap.
async function initialUrl(): Promise<string | null | undefined> {
  const url: unknown = Settings.get("telarOpenURL");
  return typeof url === "string" && url.startsWith("telar://") ? url : Linking.getInitialURL();
}

const linking: LinkingOptions<RootStack> = { prefixes: ["telar://"], config: { screens: { Pair: "pair" } }, getInitialURL: initialUrl };

export function App() {
  return (
    <NavigationContainer linking={linking}>
      <StatusBar style="auto" />
      <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
        <Stack.Screen name="Hosts" component={HostsScreen} options={{ title: "Telar" }} />
        <Stack.Screen name="Pair" component={PairScreen} options={{ title: "Pair a computer", presentation: "formSheet", headerLargeTitle: false, sheetAllowedDetents: [0.6, 1] }} />
        <Stack.Screen name="Sessions" component={SessionsScreen} options={({ route }) => ({ title: route.params.hostName })} />
        <Stack.Screen
          name="Session"
          component={SessionScreen}
          options={({ route }) => ({ title: route.params.title, headerLargeTitle: false })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
