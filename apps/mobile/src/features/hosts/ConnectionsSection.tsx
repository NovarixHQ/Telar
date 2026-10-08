import { connectionsSubtitle } from "./connect";
import { hosts, pairedHost } from "./registry";
import { CardDivider, CardNavRow, SettingsGroup } from "./settings-kit";
import { useHosts } from "./use-hosts";

/** Settings → Connections: one row per paired computer, then "Add a computer". */
export function ConnectionsSection({ onHost, onAdd }: { onHost: (hostId: string) => void; onAdd: () => void }) {
  const rows = useHosts(hosts);
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
            onPress={() => onHost(connection.hostId)}
          />,
          <CardDivider key={`${connection.hostId}-divider`} />,
        ];
      })}
      <CardNavRow icon="plus.circle.fill" title="Add a computer" subtitle="Scan a pairing code or connect by address" onPress={onAdd} />
    </SettingsGroup>
  );
}
