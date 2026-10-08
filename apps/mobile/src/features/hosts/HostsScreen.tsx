import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { present } from "../../platform/connection";
import type { RootStack } from "../../platform/navigation/routes";
import { ConnectionsSection } from "./ConnectionsSection";
import { hosts } from "./registry";
import { CardDivider, CardNavRow, SettingsGroup, SettingsPage } from "./settings-kit";
import { useHosts } from "./use-hosts";
import { WelcomeScreen } from "./WelcomeScreen";

export function HostsScreen() {
  const rows = useHosts(hosts);
  const navigation = useNavigation<NavigationProp<RootStack>>();
  if (rows.length === 0) return <WelcomeScreen />;
  return (
    <SettingsPage>
      <SettingsGroup label="Sessions">
        {rows.flatMap(({ connection, state }, index) => [
          ...(index > 0 ? [<CardDivider key={`${connection.hostId}-divider`} />] : []),
          <CardNavRow
            key={connection.hostId}
            icon="text.bubble"
            title={connection.name}
            subtitle={present(state, Date.now()).label}
            onPress={() => navigation.navigate("Sessions", { hostId: connection.hostId, hostName: connection.name })}
          />,
        ])}
      </SettingsGroup>
      <ConnectionsSection />
    </SettingsPage>
  );
}
