import { Host } from "@expo/ui/swift-ui";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { RootStack } from "../../platform/navigation/routes";
import { ConnectionsSection } from "./ConnectionsSection";
import { SettingsPage } from "./settings-kit";

/** The paired computers, shown in Settings until it has its own screen. */
export function HostsScreen() {
  const navigation = useNavigation<NavigationProp<RootStack>>();
  return (
    <Host style={{ flex: 1 }}>
      <SettingsPage title="Settings">
        <ConnectionsSection onHost={(hostId) => navigation.navigate("HostSettings", { hostId })} onAdd={() => navigation.navigate("Pair")} />
      </SettingsPage>
    </Host>
  );
}
