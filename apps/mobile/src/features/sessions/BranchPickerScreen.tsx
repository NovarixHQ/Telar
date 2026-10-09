import { Button, Host, HStack, List, ProgressView, Section, Spacer, Text } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listStyle,
  scrollContentBackground,
  shapes,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GitOverview } from "@telar/engine-client";
import { useEffect, useLayoutEffect, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { Icon, Theme } from "../../ui";
import { hosts } from "../hosts";
import { branchRows, type BranchRow } from "./new-session";

type Navigation = NativeStackNavigationProp<RootStack, "BranchPicker">;

function Row({ row, selected, onPick }: { row: BranchRow; selected: boolean; onPick: () => void }) {
  return (
    <Button onPress={onPick} modifiers={[buttonStyle("plain"), contentShape(shapes.rectangle()), listRowBackground("clear")]}>
      <HStack spacing={10}>
        <Icon name="arrow.triangle.branch" textStyle="footnote" color={Theme.textMuted} />
        <Text modifiers={[font({ textStyle: "subheadline", ...(row.mono ? { design: "monospaced" as const } : {}) }), foregroundStyle(Theme.text), lineLimit(1), truncationMode("head")]}>{row.label}</Text>
        <Spacer minLength={8} />
        {row.badge ? <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.textMuted)]}>{row.badge}</Text> : null}
        {selected ? <Icon name="checkmark" textStyle="footnote" weight="medium" color={Theme.accent} /> : null}
      </HStack>
    </Button>
  );
}

/** Which ref a new worktree branches from. */
export function BranchPickerScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<RouteProp<RootStack, "BranchPicker">>();
  const [git, setGit] = useState<GitOverview>();
  const [failed, setFailed] = useState<string>();
  const [query, setQuery] = useState("");
  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: { placeholder: "Search branches", hideWhenScrolling: false, onChangeText: (event) => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") },
    });
  }, [navigation]);
  useEffect(() => {
    const host = hosts.get(params.hostId);
    if (!host) return setFailed("That computer is no longer paired.");
    host.call(true, () => host.client.projectGit(params.projectId)).then(
      ({ git: overview }) => setGit(overview),
      (error: unknown) => setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, [params.hostId, params.projectId]);

  const rows = branchRows(git, query);
  const pick = (baseRef: string | undefined) => navigation.popTo("NewSession", { hostId: params.hostId, projectId: params.projectId, baseRef }, { merge: true });
  const draw = (row: BranchRow) => <Row key={row.value ?? "HEAD"} row={row} selected={row.value === params.baseRef} onPick={() => pick(row.value)} />;
  const muted = (text: string) => <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted), listRowBackground("clear")]}>{text}</Text>;

  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle("plain"), scrollContentBackground("hidden"), background(Theme.sheet)]}>
        {rows.pinned.map(draw)}
        {!git && !failed ? <ProgressView modifiers={[frame({ maxWidth: Infinity }), listRowBackground("clear")]} /> : null}
        {failed ? muted(failed) : null}
        {rows.local.length ? <Section title="Local">{rows.local.map(draw)}</Section> : null}
        {rows.origin.length ? <Section title="Origin">{rows.origin.map(draw)}</Section> : null}
        {query.trim() && !rows.local.length && !rows.origin.length ? muted("No matching branches.") : null}
      </List>
    </Host>
  );
}
