import { Button, ContentUnavailableView, HStack, Host, Label, List, Section, Spacer, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listSectionSpacing,
  listStyle,
  padding,
  refreshable,
  scrollContentBackground,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, NoComputers } from "../hosts";
import { Icon, Theme, type SymbolName } from "../../ui";
import { inboxFor } from "./inboxes";
import { nestRail, type NestedRow } from "./nesting";
import { searchRail, type RailRow } from "./rail";
import { RailRowView } from "./RailRows";
import { RowActions } from "./RowActions";
import { Shelves } from "./Shelves";
import { useMergedRail, type MergedRail } from "./use-rail";

type Navigation = NativeStackNavigationProp<RootStack, "Rail">;

let expandedParents: ReadonlySet<string> = new Set();

const sfSymbol = (name: string) => ({ type: "sfSymbol" as const, name: name as SymbolName });

function useToolbar(navigation: Navigation, rail: MergedRail, filter: string | undefined, setFilter: (hostId: string | undefined) => void, setQuery: (query: string) => void) {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: "Search sessions, projects, computers",
        hideWhenScrolling: false,
        placement: "stacked",
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, setQuery]);
  const computers = rail.computers;
  useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        {
          type: "menu",
          label: computers.find((computer) => computer.hostId === filter)?.name ?? "All computers",
          icon: sfSymbol("line.3.horizontal.decrease"),
          tintColor: Theme.accent,
          menu: {
            items: [
              { type: "action", label: "All computers", state: filter === undefined ? "on" : "off", onPress: () => setFilter(undefined) },
              ...computers.map((computer) => ({ type: "action" as const, label: computer.name, state: filter === computer.hostId ? ("on" as const) : ("off" as const), onPress: () => setFilter(computer.hostId) })),
            ],
          },
        },
      ],
      unstable_headerRightItems: () => [
        { type: "button", label: "Add project", icon: sfSymbol("folder.badge.plus"), tintColor: Theme.accent, onPress: () => navigation.navigate("Unavailable", { title: "Add project", systemImage: "folder.badge.plus" }) },
        { type: "button", label: "New conversation", icon: sfSymbol("square.and.pencil"), tintColor: Theme.accent, onPress: () => navigation.navigate("Unavailable", { title: "New conversation", systemImage: "square.and.pencil" }) },
      ],
    });
  }, [navigation, computers, filter, setFilter]);
}

function FailureBanners({ rail }: { rail: MergedRail }) {
  return rail.failures.map((failure) => (
    <HStack key={failure.hostId} modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.amber)]}>
      <Label title={failure.needsPairing ? `${failure.name} needs pairing` : `${failure.name} is offline · showing saved sessions`} systemImage={failure.needsPairing ? "lock" : "wifi.slash"} />
      <Spacer minLength={4} />
      {failure.needsPairing ? null : (
        <Button
          label="Retry"
          modifiers={[buttonStyle("borderless"), font({ textStyle: "caption", weight: "medium" })]}
          onPress={() => {
            hosts.get(failure.hostId)?.wake("reconnect");
            void inboxFor(failure.hostId)?.refresh();
          }}
        />
      )}
    </HStack>
  ));
}

function BottomBar({ onSettings, onUsage }: { onSettings: () => void; onUsage: () => void }) {
  const insets = useSafeAreaInsets();
  const glyph = (name: SymbolName, label: string, onPress: () => void) => (
    <Button modifiers={[buttonStyle("plain"), accessibilityLabel(label)]} onPress={onPress}>
      <Icon name={name} size={17} modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]} />
    </Button>
  );
  return (
    <View style={{ paddingBottom: insets.bottom }}>
      <Host matchContents={{ vertical: true }}>
        <HStack spacing={0} modifiers={[foregroundStyle(Theme.textMuted), padding({ horizontal: 8 }), background(Theme.sheet)]}>
          {glyph("gearshape", "Settings", onSettings)}
          {glyph("chart.bar", "Usage", onUsage)}
          <Spacer minLength={0} />
        </HStack>
      </Host>
    </View>
  );
}

function EmptyState({ rail }: { rail: MergedRail }) {
  if (!rail.loaded || rail.sections.active.length + rail.sections.snoozed.length + rail.sections.settled.length > 0) return null;
  return rail.hasProjects ? (
    <ContentUnavailableView title="No sessions yet" systemImage="text.bubble" description="Start one from the button above." />
  ) : (
    <ContentUnavailableView title="No projects yet" systemImage="folder.badge.plus" description="Register a project to start a session." />
  );
}

/** Home: one list of every paired computer's sessions, titled Telar. */
export function RailScreen() {
  const navigation = useNavigation<Navigation>();
  const [chosen, setFilter] = useState<string>();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(expandedParents);
  useEffect(() => {
    expandedParents = expanded;
  }, [expanded]);
  const [actionError, setActionError] = useState<string>();
  const rail = useMergedRail(chosen);
  useToolbar(navigation, rail, rail.filter, setFilter, setQuery);

  if (rail.computers.length === 0) return <NoComputers onPair={() => navigation.navigate("Pair")} />;

  const hostName = (hostId: string) => rail.computers.find((computer) => computer.hostId === hostId)?.name;
  const markFor = (row: RailRow) => (rail.computers.length > 1 ? (hostName(row.hostId) ?? "Computer") : undefined);
  const open = (row: RailRow) => navigation.navigate("Session", { hostId: row.hostId, sessionId: row.sessionId, title: row.title });
  const toggle = (key: string) => setExpanded((current) => (current.has(key) ? new Set([...current].filter((entry) => entry !== key)) : new Set([...current, key])));
  const draw = ({ row, family, nested }: NestedRow, slim = false) => (
    <RowActions key={row.key} row={row} onSnooze={(target) => navigation.navigate("Snooze", { hostId: target.hostId, sessionId: target.sessionId })} onError={setActionError}>
      <RailRowView
        row={row}
        host={markFor(row)}
        slim={slim}
        nested={nested}
        stale={rail.stale.has(row.hostId)}
        {...(family ? { family: { family, open: expanded.has(family.key), onToggle: () => toggle(family.key) } } : {})}
        onOpen={() => open(row)}
      />
    </RowActions>
  );
  const drawSlim = (row: RailRow) => draw({ row, nested: false }, true);
  const nestedRail = nestRail(rail, expanded);
  const found = query.trim() ? searchRail([...rail.sections.active, ...rail.sections.snoozed, ...rail.sections.settled], query, hostName) : undefined;
  const refreshAll = async () => {
    await Promise.all(rail.computers.map((computer) => inboxFor(computer.hostId)?.refresh()));
  };

  return (
    <View style={{ flex: 1 }}>
      <Host style={{ flex: 1 }}>
        <List modifiers={[listStyle("insetGrouped"), listSectionSpacing(12), scrollContentBackground("hidden"), background(Theme.sheet), refreshable(refreshAll)]}>
          <FailureBanners rail={rail} />
          {actionError ? <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.red)]}>{actionError}</Text> : null}
          {found ? (
            found.length > 0 ? (
              found.map(drawSlim)
            ) : (
              <ContentUnavailableView title="No sessions found" systemImage="text.bubble" description="Try another title or project." />
            )
          ) : (
            <>
              {nestedRail.pinned.length > 0 ? <Section>{nestedRail.pinned.map((item) => draw(item))}</Section> : null}
              {nestedRail.rows.length > 0 ? <Section>{nestedRail.rows.map((item) => draw(item))}</Section> : null}
              <Shelves rail={rail} draw={drawSlim} />
              <EmptyState rail={rail} />
            </>
          )}
        </List>
      </Host>
      <BottomBar onSettings={() => navigation.navigate("Settings")} onUsage={() => navigation.navigate("Unavailable", { title: "Usage", systemImage: "chart.bar" })} />
    </View>
  );
}
