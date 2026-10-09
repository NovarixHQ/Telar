import { Button, ContextMenu, HStack, Host, Text as SwiftText } from "@expo/ui/swift-ui";
import { buttonStyle, disabled, monospacedDigit, padding } from "@expo/ui/swift-ui/modifiers";
import type { GitCommitEntry, GitFileChange, SessionDiff } from "@telar/engine-client";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TurboModuleRegistry, View, type TurboModule } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { bandCaption, EmptyState, faded } from "../../ui";
import { DiffCommitRow, DiffFileRow, DiffSummary } from "./DiffRows";
import { PatchBody } from "./PatchBody";
import { diffNotes, fileLine } from "./summary";

type Item =
  | { key: string; type: "summary" }
  | { key: string; type: "file"; file: GitFileChange; open: boolean }
  | { key: string; type: "patch"; file: GitFileChange }
  | { key: string; type: "commits" }
  | { key: string; type: "commit"; commit: GitCommitEntry };

const clipboard = TurboModuleRegistry.get<TurboModule & { setString(text: string): void }>("Clipboard");

/** A SwiftUI row inside the list; the list mounts only the rows near the screen, so only those pay for a host. */
const SwiftRow = ({ children, separator }: { children: ReactNode; separator?: boolean }) => (
  <View>
    <Host matchContents={{ vertical: true }}>{children}</Host>
    {separator ? <View style={styles.separator} /> : null}
  </View>
);

const FileRow = memo(function FileRow({ file, open, onToggle, onOpenFile }: { file: GitFileChange; open: boolean; onToggle: (path: string) => void; onOpenFile?: (path: string) => void }) {
  return (
    <SwiftRow separator>
      <ContextMenu modifiers={[padding({ horizontal: 16 })]}>
        <ContextMenu.Items>
          {file.status === "deleted" ? null : <Button label="Open in Editor" systemImage="sidebar.trailing" onPress={() => onOpenFile?.(file.path)} modifiers={onOpenFile ? [] : [disabled(true)]} />}
          {clipboard ? <Button label="Copy path" systemImage="doc.on.doc" onPress={() => clipboard.setString(file.path)} /> : null}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <Button onPress={() => onToggle(file.path)} modifiers={[buttonStyle("plain")]}>
            <DiffFileRow line={fileLine(file)} open={open} />
          </Button>
        </ContextMenu.Trigger>
      </ContextMenu>
    </SwiftRow>
  );
});

function items(diff: SessionDiff, collapsed: ReadonlySet<string>): Item[] {
  const list: Item[] = [{ key: "summary", type: "summary" }];
  for (const file of diff.files) {
    const open = !collapsed.has(file.path);
    list.push({ key: `file:${file.path}`, type: "file", file, open });
    if (open) list.push({ key: `patch:${file.path}`, type: "patch", file });
  }
  if (diff.commits.length > 0) list.push({ key: "commits", type: "commits" }, ...diff.commits.map((commit) => ({ key: `commit:${commit.sha}`, type: "commit" as const, commit })));
  return list;
}

/** What a session changed: a summary, each file's patch, and its commits. Pull to read it again. */
export function DiffSurface({ host, sessionId, onOpenFile }: { host: HostConnection; sessionId: string; onOpenFile?: (path: string) => void }) {
  const [diff, setDiff] = useState<SessionDiff>();
  const [failed, setFailed] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setDiff((await host.call(true, () => host.client.sessionDiff(sessionId))).diff);
      setGeneration((current) => current + 1);
      setFailed(undefined);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [host, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const data = useMemo(() => (diff ? items(diff, collapsed) : []), [diff, collapsed]);

  const render = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "summary":
          return (
            <SwiftRow>
              <HStack modifiers={[padding({ top: 14, leading: 16, bottom: 10, trailing: 16 })]}>{diff ? <DiffSummary diff={diff} notes={diffNotes(diff)} /> : null}</HStack>
            </SwiftRow>
          );
        case "file":
          return <FileRow file={item.file} open={item.open} onToggle={toggle} {...(onOpenFile ? { onOpenFile } : {})} />;
        case "patch":
          return (
            <View style={styles.patch}>
              <PatchBody host={host} sessionId={sessionId} file={item.file} generation={generation} />
            </View>
          );
        case "commits":
          return (
            <SwiftRow>
              <HStack spacing={6} modifiers={[...bandCaption, padding({ top: 24, leading: 16, bottom: 6, trailing: 16 })]}>
                <SwiftText>Commits</SwiftText>
                <SwiftText modifiers={[monospacedDigit()]}>{String(diff?.commits.length ?? 0)}</SwiftText>
              </HStack>
            </SwiftRow>
          );
        case "commit":
          return (
            <SwiftRow separator>
              <HStack modifiers={[padding({ horizontal: 16, vertical: 4 })]}>
                <DiffCommitRow commit={item.commit} now={Date.now()} />
              </HStack>
            </SwiftRow>
          );
      }
    },
    [diff, generation, host, sessionId, toggle, onOpenFile],
  );

  if (failed && !diff) return <EmptyState icon="xmark.circle" title="Could not load changes" detail={failed} />;
  if (!diff) return <ActivityIndicator style={styles.loading} />;
  const unchanged = diff.files.length === 0 && diff.commits.length === 0 && !diff.filesIncomplete;
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      ListFooterComponent={unchanged ? <EmptyState icon="checkmark.circle" title="No changes yet." /> : undefined}
      ListFooterComponentStyle={styles.fill}
      data={data}
      keyExtractor={(item) => item.key}
      renderItem={render}
      initialNumToRender={8}
      maxToRenderPerBatch={3}
      windowSize={3}
      removeClippedSubviews
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  loading: { flex: 1 },
  content: { flexGrow: 1 },
  fill: { flex: 1 },
  patch: { paddingHorizontal: 16, paddingBottom: 10 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 62, marginRight: 16, backgroundColor: faded("border", 0.6) },
});
