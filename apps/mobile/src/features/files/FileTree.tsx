import { Button, Circle, ContentUnavailableView, ContextMenu, HStack, Host, Spacer, Text as SwiftText, TextField } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  rotationEffect,
  shapes,
  textInputAutocapitalization,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { GitChangeStatus, WorkspaceListing } from "@telar/engine-client";
import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TurboModuleRegistry, View, type TurboModule } from "react-native";
import { faded, Icon, Theme } from "../../ui";
import { buildFileTree, directoryPaths, fileGlyph, flattenTree, matchFiles, MAX_SEARCH_MATCHES, statusMark, type FileRow } from "./tree";

const clipboard = TurboModuleRegistry.get<TurboModule & { setString(text: string): void }>("Clipboard");

const absolutePath = (root: string, path: string) => `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

type RowProps = { row: FileRow; open: boolean; active: boolean; status?: GitChangeStatus | undefined; dirty: boolean; root?: string | undefined; onPress: (row: FileRow) => void };

const TreeRow = memo(function TreeRow({ row, open, active, status, dirty, root, onPress }: RowProps) {
  const { node, depth } = row;
  const mark = status ? statusMark(status) : undefined;
  const label = (
    <Button onPress={() => onPress(row)} modifiers={[buttonStyle("plain")]}>
      <HStack
        spacing={5}
        modifiers={[padding({ leading: depth * 12 + 8, trailing: 10 }), frame({ minHeight: 26, maxWidth: Infinity, alignment: "leading" }), background(active ? Theme.subtleStrong : "transparent"), contentShape(shapes.rectangle())]}
      >
        {node.children ? (
          <>
            <Icon name="chevron.right" textStyle="caption2" weight="semibold" color={faded("textMuted", 0.7)} modifiers={[rotationEffect(open ? 90 : 0), frame({ width: 10 })]} />
            <Icon name={open ? "folder.fill" : "folder"} textStyle="caption" color={Theme.textMuted} />
          </>
        ) : (
          <>
            <Spacer modifiers={[frame({ width: 10 })]} />
            <Icon name={fileGlyph(node.path)} textStyle="caption" color={Theme.textMuted} />
          </>
        )}
        <SwiftText modifiers={[font({ textStyle: "footnote", design: "monospaced" }), foregroundStyle(active ? Theme.text : Theme.textMuted), lineLimit(1), truncationMode("middle")]}>{node.name}</SwiftText>
        <Spacer minLength={4} />
        {mark ? (
          <SwiftText modifiers={[font({ textStyle: "caption", design: "monospaced", weight: "bold" }), foregroundStyle(Theme[mark.tone])]}>{mark.letter}</SwiftText>
        ) : dirty && !open ? (
          <Circle modifiers={[foregroundStyle(Theme.amber), frame({ width: 5, height: 5 })]} />
        ) : null}
      </HStack>
    </Button>
  );
  return (
    <Host matchContents={{ vertical: true }}>
      {node.children || !clipboard ? (
        label
      ) : (
        <ContextMenu>
          <ContextMenu.Items>
            <Button label="Open" systemImage="doc" onPress={() => onPress(row)} />
            {root ? <Button label="Copy path" systemImage="doc.on.doc" onPress={() => clipboard.setString(absolutePath(root, node.path))} /> : null}
            <Button label="Copy relative path" systemImage="doc.on.doc" onPress={() => clipboard.setString(node.path)} />
          </ContextMenu.Items>
          <ContextMenu.Trigger>{label}</ContextMenu.Trigger>
        </ContextMenu>
      )}
    </Host>
  );
});

type Props = {
  listing: WorkspaceListing | undefined;
  error: string | undefined;
  statuses: ReadonlyMap<string, GitChangeStatus>;
  query: string;
  expanded: ReadonlySet<string>;
  activePath: string | undefined;
  onQuery: (query: string) => void;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
};

function foot(listing: WorkspaceListing, dropped: number): string {
  if (dropped > 0) return `First ${MAX_SEARCH_MATCHES} matches; ${dropped} more not shown.`;
  return `${listing.files.length} files${listing.truncated ? " (capped)" : ""} · ${listing.source === "git" ? "tracked and unignored, from git" : "walked — not a repository"}`;
}

/** The checkout as a folding tree with a search field; a search opens every folder it matches in. */
export function FileTree({ listing, error, statuses, query, expanded, activePath, onQuery, onToggle, onOpen, onRefresh }: Props) {
  const tree = useMemo(() => buildFileTree(listing?.files ?? []), [listing]);
  const { rows, open, dropped } = useMemo(() => {
    const { matches, dropped } = matchFiles(listing?.files ?? [], query);
    const nodes = query ? buildFileTree(matches) : tree;
    const open = query ? new Set(directoryPaths(nodes)) : expanded;
    return { rows: flattenTree(nodes, open), open, dropped };
  }, [listing, query, tree, expanded]);
  const dirtyDirs = useMemo(() => {
    const dirs = new Set<string>();
    for (const path of statuses.keys()) for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1)) dirs.add(path.slice(0, at));
    return dirs;
  }, [statuses]);

  const press = useCallback((row: FileRow) => (row.node.children ? onToggle(row.node.path) : onOpen(row.node.path)), [onToggle, onOpen]);
  const render = useCallback(
    ({ item }: { item: FileRow }) => (
      <TreeRow
        row={item}
        open={open.has(item.node.path)}
        active={activePath === item.node.path}
        status={item.node.children ? undefined : statuses.get(item.node.path)}
        dirty={!!item.node.children && dirtyDirs.has(item.node.path)}
        root={listing?.workspacePath}
        onPress={press}
      />
    ),
    [open, activePath, statuses, dirtyDirs, listing, press],
  );

  return (
    <View style={styles.column}>
      <Host matchContents={{ vertical: true }}>
        <HStack spacing={6} modifiers={[padding({ horizontal: 10 }), frame({ minHeight: 32 })]}>
          <Icon name="magnifyingglass" textStyle="caption" color={Theme.textMuted} />
          <TextField placeholder="Search files" onTextChange={onQuery} modifiers={[font({ textStyle: "footnote" }), textInputAutocapitalization("never"), autocorrectionDisabled(true)]} />
          <Button onPress={onRefresh} modifiers={[buttonStyle("plain"), accessibilityLabel("Refresh files")]}>
            <Icon name="arrow.clockwise" textStyle="caption" color={Theme.textMuted} />
          </Button>
        </HStack>
      </Host>
      <View style={styles.rule} />
      {listing && rows.length === 0 ? (
        <Host style={styles.fill}>
          <ContentUnavailableView
            title={query ? "Nothing matches" : "This checkout is empty"}
            systemImage="folder"
            description={query ? `No path in this checkout contains "${query}".` : "git lists no files here."}
          />
        </Host>
      ) : listing ? (
        <>
          <FlatList style={styles.fill} contentContainerStyle={styles.list} data={rows} keyExtractor={(row) => row.node.path} renderItem={render} initialNumToRender={30} windowSize={7} keyboardDismissMode="on-drag" />
          <View style={styles.rule} />
          <Text style={styles.foot}>{foot(listing, dropped)}</Text>
        </>
      ) : error ? (
        <Host style={styles.fill}>
          <ContentUnavailableView title="Could not read the checkout" systemImage="xmark.circle" description={error} />
        </Host>
      ) : (
        <ActivityIndicator style={styles.fill} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, backgroundColor: Theme.sheet },
  fill: { flex: 1 },
  list: { paddingVertical: 4 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  foot: { fontSize: 12, color: Theme.textMuted, paddingHorizontal: 10, paddingVertical: 5 },
});
