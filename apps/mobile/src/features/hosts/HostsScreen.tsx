import { Button, ContentUnavailableView, Host, LabeledContent, List, Text, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { present } from "../../platform/connection";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts } from "./registry";
import { useHosts } from "./use-hosts";

export function HostsScreen() {
  const rows = useHosts(hosts);
  const navigation = useNavigation<NavigationProp<RootStack>>();
  if (rows.length === 0) {
    return (
      <Host style={{ flex: 1 }}>
        <VStack spacing={16}>
          <ContentUnavailableView
            title="No computers yet"
            systemImage="desktopcomputer"
            description="Pair this phone with Telar on your computer to follow and steer its sessions."
          />
          <Button label="Pair a computer" modifiers={[buttonStyle("glassProminent"), controlSize("large")]} />
        </VStack>
      </Host>
    );
  }
  return (
    <Host style={{ flex: 1 }}>
      <List>
        {rows.map(({ connection, state }) => (
          <Button
            key={connection.hostId}
            onPress={() => navigation.navigate("Sessions", { hostId: connection.hostId, hostName: connection.name })}
          >
            <LabeledContent label={connection.name}>
              <Text>{present(state, Date.now()).label}</Text>
            </LabeledContent>
          </Button>
        ))}
      </List>
    </Host>
  );
}
