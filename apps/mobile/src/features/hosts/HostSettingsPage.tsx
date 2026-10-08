import { Button, ConfirmationDialog, Host, Text } from "@expo/ui/swift-ui";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { connectionRowSubtitle } from "./connect";
import { CardField, useField } from "./fields";
import { forgetHost, hosts, pairedHost, renameHost } from "./registry";
import { CardButtonRow, CardDivider, CardNavRow, SettingsGroup, SettingsPage } from "./settings-kit";
import { useHosts } from "./use-hosts";

type HostPageLinks = { onConnection: () => void; onDevices: () => void; onDictation: () => void; onSimulators: () => void; onRemoved: () => void };

/** One computer's page in Settings: its name, how it is reached, and removing it from this phone. Push it on a SwiftUI stack. */
function HostSettingsPage({ hostId, onConnection, onDevices, onDictation, onSimulators, onRemoved }: { hostId: string } & HostPageLinks) {
  useHosts(hosts);
  const host = pairedHost(hostId);
  const state = hosts.get(hostId)?.state;
  const name = useField(host?.name ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const draft = useRef(name.value);
  draft.current = name.value;
  const commit = () => void renameHost(hostId, draft.current);
  useEffect(() => () => void renameHost(hostId, draft.current), [hostId]);

  const address = state?.kind === "online" ? state.address : host?.paired[0];
  const placeholder = address ? new URL(address).hostname : "My computer";

  return (
    <SettingsPage title={host?.name ?? "Computer"}>
      <SettingsGroup label="Name" footer="Shown on inbox rows and menus.">
        <CardField placeholder={placeholder} field={name} onDone={commit} />
      </SettingsGroup>

      <SettingsGroup label="This computer">
        <CardNavRow icon="server.rack" title="Connection" subtitle={connectionRowSubtitle(host?.token ?? "", address)} onPress={onConnection} />
        {host?.token ? (
          <>
            <CardDivider />
            <CardNavRow icon="iphone.radiowaves.left.and.right" title="Devices" subtitle="Who may reach this computer" onPress={onDevices} />
            <CardDivider />
            <CardNavRow icon="waveform" title="Dictation" subtitle="Speech to text" onPress={onDictation} />
            <CardDivider />
            <CardNavRow icon="iphone" title="Simulators" subtitle="Watch and drive its simulators" onPress={onSimulators} />
          </>
        ) : null}
      </SettingsGroup>

      <SettingsGroup footer="The Mac keeps running. Revoke this phone in its Devices settings.">
        <ConfirmationDialog title={`Remove ${host?.name ?? "this computer"}?`} titleVisibility="visible" isPresented={confirmRemove} onIsPresentedChange={setConfirmRemove}>
          <ConfirmationDialog.Trigger>
            <CardButtonRow icon="trash" iconColor={Theme.red} title="Remove this computer" titleColor={Theme.red} onPress={() => setConfirmRemove(true)} />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button
              label="Remove"
              role="destructive"
              onPress={() => {
                draft.current = "";
                void forgetHost(hostId);
                onRemoved();
              }}
            />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>This phone forgets the credential and any pending drafts for it. Pair again anytime.</Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
      </SettingsGroup>
    </SettingsPage>
  );
}

const notYet = (title: string) => () => Alert.alert(title, "Not available on the phone yet.");

/** The `HostSettings` route, until Settings pushes the page on its own stack. */
export function HostSettingsScreen() {
  const { params } = useRoute<RouteProp<RootStack, "HostSettings">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const name = pairedHost(params.hostId)?.name;
  useEffect(() => navigation.setOptions({ title: name ?? "Computer" }), [navigation, name]);
  return (
    <Host style={{ flex: 1 }}>
      <HostSettingsPage
        hostId={params.hostId}
        onConnection={() => navigation.navigate("Pair", { hostId: params.hostId })}
        onDevices={notYet("Devices")}
        onDictation={notYet("Dictation")}
        onSimulators={notYet("Simulators")}
        onRemoved={() => navigation.goBack()}
      />
    </Host>
  );
}
