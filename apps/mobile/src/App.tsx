import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { HostsScreen } from "./features/hosts";
import { SessionScreen, SessionsScreen } from "./features/sessions";
import type { RootStack } from "./platform/navigation/routes";

const Stack = createNativeStackNavigator<RootStack>();

export function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator screenOptions={{ headerLargeTitle: true }}>
        <Stack.Screen name="Hosts" component={HostsScreen} options={{ title: "Telar" }} />
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
