import { Button, ContentUnavailableView, Host, LabeledContent, List, Section, Text, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { present } from "../../platform/connection";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts } from "./registry";
import { useHosts } from "./use-hosts";

export function NoComputers({ onPair }: { onPair: () => void }) {
  return (
    <Host style={{ flex: 1 }}>
      <VStack spacing={16}>
        <ContentUnavailableView title="No computers yet" systemImage="desktopcomputer" description="Pair this phone with Telar on your computer to follow and steer its sessions." />
        <Button label="Pair a computer" onPress={onPair} modifiers={[buttonStyle("glassProminent"), controlSize("large")]} />
      </VStack>
    </Host>
  );
}

/** The paired computers, shown in Settings until it has its own screen. */
export function HostsScreen() {
  const rows = useHosts(hosts);
  const navigation = useNavigation<NavigationProp<RootStack>>();
  return (
    <Host style={{ flex: 1 }}>
      <List>
        <Section title="Connections">
          {rows.map(({ connection, state }) => (
            <LabeledContent key={connection.hostId} label={connection.name}>
              <Text>{present(state, Date.now()).label}</Text>
            </LabeledContent>
          ))}
          <Button label="Add a computer" systemImage="plus.circle.fill" onPress={() => navigation.navigate("Pair")} />
        </Section>
      </List>
    </Host>
  );
}
