import { Button, Host, NavigationDestination, NavigationStack, Toolbar, ToolbarItem } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Platform, Share } from "react-native";
import { hosts, useHosts } from "../hosts";
import { appSettings, useAppSettings } from "./app-settings";
import { destinationValue, parseDestination, type Destination } from "./destinations";
import { connectionReport, hostSubtitle } from "./connection-report";
import { DevicesPage } from "./DevicesPage";
import { DictationPage, VocabularyPage } from "./DictationPages";
import { AppearancePage, GeneralPage } from "./GeneralPages";
import { adoptGroupBy } from "./group-by";
import { CardButtonRow, CardDivider, CardNavRow, CardValueRow, SettingsCard, SettingsGroup, SettingsPage } from "./kit";
import { layoutHosts } from "./layout-hosts";
import { NotificationsPage, SoundPage } from "./NotificationPages";
import { SimulatorsPage } from "./SimulatorsPage";
import { notificationsSummary } from "./store";
import { Icon, Theme } from "../../ui";

type Push = (destination: Destination) => void;

function version(): string {
  const config = Constants.expoConfig;
  const build = config?.ios?.buildNumber;
  return build ? `${config?.version ?? "?"} (${build})` : (config?.version ?? "?");
}

/** Placeholder until the hosts feature's ConnectionsSection lands: one row per computer, then Add a computer. */
function Connections({ push, onAddComputer }: { push: Push; onAddComputer: () => void }) {
  const rows = useHosts(hosts);
  return (
    <SettingsGroup label="Connections" footer="Every computer pairs with its own key. Sessions from all of them share the inbox.">
      {rows.map(({ connection, state }) => (
        <Fragment key={connection.hostId}>
          <CardNavRow icon="desktopcomputer" title={connection.name} subtitle={hostSubtitle({ state, addresses: connection.addresses() })} onPress={() => push({ page: "host", hostId: connection.hostId })} />
          <CardDivider />
        </Fragment>
      ))}
      <CardNavRow icon="plus.circle.fill" title="Add a computer" subtitle="Scan a pairing code or connect by address" onPress={onAddComputer} />
    </SettingsGroup>
  );
}

function HostPage({ hostId, push }: { hostId: string; push: Push }) {
  return (
    <SettingsPage title={hosts.get(hostId)?.name ?? "Computer"}>
      <SettingsCard>
        <CardNavRow icon="iphone.radiowaves.left.and.right" title="Devices" subtitle="Who may reach this computer" onPress={() => push({ page: "devices", hostId })} />
        <CardDivider />
        <CardNavRow icon="waveform" title="Dictation" subtitle="Speech to text" onPress={() => push({ page: "dictation", hostId })} />
        <CardDivider />
        <CardNavRow icon="iphone" title="Simulators" subtitle="Watch and drive its simulators" onPress={() => push({ page: "simulators", hostId })} />
      </SettingsCard>
    </SettingsPage>
  );
}

function RootPage({ push, onAddComputer }: { push: Push; onAddComputer: () => void }) {
  const settings = useAppSettings();
  const rows = useHosts(hosts);
  const exportLog = () => {
    const report = rows.map(({ connection, state }) => ({ hostId: connection.hostId, name: connection.name, state, addresses: connection.addresses() }));
    void Share.share({ title: "Connection log", message: connectionReport(report, new Date()) });
  };
  return (
    <SettingsPage title="Settings">
      <SettingsCard>
        <CardNavRow icon="gearshape" title="General" subtitle="Session list" onPress={() => push({ page: "general" })} />
        {Platform.OS === "ios" && Platform.isPad ? (
          <>
            <CardDivider />
            <CardNavRow icon="paintbrush" title="Appearance" subtitle="Chat width" onPress={() => push({ page: "appearance" })} />
          </>
        ) : null}
        <CardDivider />
        <CardNavRow icon="bell.badge" title="Notifications" subtitle={notificationsSummary(settings)} onPress={() => push({ page: "notifications" })} />
      </SettingsCard>
      <Connections push={push} onAddComputer={onAddComputer} />
      <SettingsGroup label="About">
        <CardValueRow icon="info.circle" title="Version" value={version()} />
        <CardDivider />
        <CardButtonRow icon="waveform.path.ecg" title="Export connection log" subtitle="Each computer's state and addresses" onPress={exportLog}>
          <Icon name="square.and.arrow.up" textStyle="footnote" weight="medium" color={Theme.textMuted} />
        </CardButtonRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

function page(destination: Destination, push: Push): ReactNode {
  switch (destination.page) {
    case "general":
      return <GeneralPage />;
    case "appearance":
      return <AppearancePage />;
    case "notifications":
      return <NotificationsPage onSound={() => push({ page: "sound" })} />;
    case "sound":
      return <SoundPage />;
    case "host":
      return <HostPage hostId={destination.hostId} push={push} />;
    case "devices":
      return <DevicesPage hostId={destination.hostId} />;
    case "dictation":
      return <DictationPage hostId={destination.hostId} onVocabulary={() => push({ page: "vocabulary", hostId: destination.hostId })} />;
    case "vocabulary":
      return <VocabularyPage hostId={destination.hostId} />;
    case "simulators":
      return <SimulatorsPage hostId={destination.hostId} />;
  }
}

/**
 * The Settings sheet: present it modally with no header; it draws its own stack and Done.
 * `open` pushes pages at once, e.g. `[{ page: "devices", hostId }]`.
 */
export function SettingsScreen({ onDone, onAddComputer, open = [] }: { onDone: () => void; onAddComputer: () => void; open?: Destination[] }) {
  const [path, setPath] = useState(() => open.map(destinationValue));
  const push: Push = (destination) => setPath((current) => [...current, destinationValue(destination)]);
  const anyOnline = useHosts(hosts).some((row) => row.state.kind === "online");
  useEffect(() => {
    if (anyOnline) void adoptGroupBy(appSettings, layoutHosts(hosts.list().map((connection) => ({ connection, state: connection.state }))));
  }, [anyOnline]);

  return (
    <Host style={{ flex: 1 }}>
      <NavigationStack path={path} onPathChange={setPath} modifiers={[tint(Theme.accent)]}>
        <Toolbar>
          <RootPage push={push} onAddComputer={onAddComputer} />
          <Toolbar.Content>
            <ToolbarItem placement="confirmationAction">
              <Button label="Done" onPress={onDone} />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
        {path.map((value) => {
          const destination = parseDestination(value);
          return destination ? (
            <NavigationDestination key={value} value={value}>
              {page(destination, push)}
            </NavigationDestination>
          ) : null;
        })}
      </NavigationStack>
    </Host>
  );
}
