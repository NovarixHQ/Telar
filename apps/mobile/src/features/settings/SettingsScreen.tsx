import { Button, Host, NavigationDestination, NavigationStack, Toolbar, ToolbarItem } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Share } from "react-native";
import { ConnectionsSection, ConnectPage, HostSettingsPage, hosts, useHosts } from "../hosts";
import { appSettings, useAppSettings } from "./app-settings";
import { destinationValue, parseDestination, type Destination } from "./destinations";
import { connectionReport } from "./connection-report";
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
type Stack = { push: Push; pop: () => void };

function version(): string {
  const config = Constants.expoConfig;
  const build = config?.ios?.buildNumber;
  return build ? `${config?.version ?? "?"} (${build})` : (config?.version ?? "?");
}

function RootPage({ push }: { push: Push }) {
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
      <ConnectionsSection onHost={(hostId) => push({ page: "host", hostId })} onAdd={() => push({ page: "connect" })} />
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

function page(destination: Destination, { push, pop }: Stack): ReactNode {
  switch (destination.page) {
    case "general":
      return <GeneralPage />;
    case "appearance":
      return <AppearancePage />;
    case "notifications":
      return <NotificationsPage onSound={() => push({ page: "sound" })} />;
    case "sound":
      return <SoundPage />;
    case "host": {
      const { hostId } = destination;
      return (
        <HostSettingsPage
          hostId={hostId}
          onConnection={() => push({ page: "connect", hostId })}
          onDevices={() => push({ page: "devices", hostId })}
          onDictation={() => push({ page: "dictation", hostId })}
          onSimulators={() => push({ page: "simulators", hostId })}
          onRemoved={pop}
        />
      );
    }
    case "connect":
      return <ConnectPage {...("hostId" in destination ? { hostId: destination.hostId } : {})} />;
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
export function SettingsScreen({ onDone, open = [] }: { onDone: () => void; open?: Destination[] }) {
  const [path, setPath] = useState(() => open.map(destinationValue));
  const push: Push = (destination) => setPath((current) => [...current, destinationValue(destination)]);
  const pop = () => setPath((current) => current.slice(0, -1));
  const anyOnline = useHosts(hosts).some((row) => row.state.kind === "online");
  useEffect(() => {
    if (anyOnline) void adoptGroupBy(appSettings, layoutHosts(hosts.list().map((connection) => ({ connection, state: connection.state }))));
  }, [anyOnline]);

  return (
    <Host style={{ flex: 1 }}>
      <NavigationStack path={path} onPathChange={setPath} modifiers={[tint(Theme.accent)]}>
        <Toolbar>
          <RootPage push={push} />
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
              {page(destination, { push, pop })}
            </NavigationDestination>
          ) : null;
        })}
      </NavigationStack>
    </Host>
  );
}
