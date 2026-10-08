import { useNavigation, type NavigationProp } from "@react-navigation/native";
import type { RootStack } from "../../platform/navigation/routes";
import { connectionsSubtitle } from "./connect";
import { hosts, pairedHost } from "./registry";
import { CardDivider, CardNavRow, SettingsGroup } from "./settings-kit";
import { useHosts } from "./use-hosts";

/** Settings → Connections: one row per paired computer, then "Add a computer". */
export function ConnectionsSection() {
  const rows = useHosts(hosts);
  const navigation = useNavigation<NavigationProp<RootStack>>();
  return (
    <SettingsGroup label="Connections" footer="Every computer pairs with its own key. Sessions from all of them share the inbox.">
      {rows.flatMap(({ connection, state }) => {
        const address = state.kind === "online" ? state.address : connection.addresses()[0];
        return [
          <CardNavRow
            key={connection.hostId}
            icon="desktopcomputer"
            title={connection.name}
            subtitle={connectionsSubtitle(pairedHost(connection.hostId)?.token ?? "", address)}
            onPress={() => navigation.navigate("HostSettings", { hostId: connection.hostId })}
          />,
          <CardDivider key={`${connection.hostId}-divider`} />,
        ];
      })}
      <CardNavRow icon="plus.circle.fill" title="Add a computer" subtitle="Scan a pairing code or connect by address" onPress={() => navigation.navigate("Pair")} />
    </SettingsGroup>
  );
}
