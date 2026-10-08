import { Button, ConfirmationDialog, Text } from "@expo/ui/swift-ui";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { connectionRowSubtitle } from "./connect";
import { forgetHost, hosts, pairedHost, renameHost } from "./registry";
import { CardButtonRow, CardDivider, CardField, CardNavRow, SettingsGroup, SettingsPage, useField } from "./settings-kit";
import { useHosts } from "./use-hosts";

const notYet = (title: string) => () => Alert.alert(title, "Not available on the phone yet.");

/** One computer's page in Settings: its name, how it is reached, and removing it from this phone. */
export function HostSettingsScreen() {
  const { params } = useRoute<RouteProp<RootStack, "HostSettings">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  useHosts(hosts);
  const host = pairedHost(params.hostId);
  const connection = hosts.get(params.hostId);
  const name = useField(host?.name ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const draft = useRef(name.value);
  draft.current = name.value;
  const commit = () => void renameHost(params.hostId, draft.current);
  useEffect(() => {
    navigation.setOptions({ title: host?.name ?? "Computer" });
  }, [navigation, host?.name]);
  useEffect(() => () => void renameHost(params.hostId, draft.current), [params.hostId]);

  const state = connection?.state;
  const address = state?.kind === "online" ? state.address : host?.paired[0];
  const paired = Boolean(host?.token);
  const placeholder = address ? new URL(address).hostname : "My computer";

  return (
    <SettingsPage>
      <SettingsGroup label="Name" footer="Shown on inbox rows and menus.">
        <CardField placeholder={placeholder} field={name} onDone={commit} />
      </SettingsGroup>

      <SettingsGroup label="This computer">
        <CardNavRow icon="server.rack" title="Connection" subtitle={connectionRowSubtitle(host?.token ?? "", address)} onPress={() => navigation.navigate("Pair", { hostId: params.hostId })} />
        {paired ? (
          <>
            <CardDivider />
            <CardNavRow icon="iphone.radiowaves.left.and.right" title="Devices" subtitle="Who may reach this computer" onPress={notYet("Devices")} />
            <CardDivider />
            <CardNavRow icon="waveform" title="Dictation" subtitle="Speech to text" onPress={notYet("Dictation")} />
            <CardDivider />
            <CardNavRow icon="iphone" title="Simulators" subtitle="Watch and drive its simulators" onPress={notYet("Simulators")} />
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
                void forgetHost(params.hostId);
                navigation.goBack();
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
