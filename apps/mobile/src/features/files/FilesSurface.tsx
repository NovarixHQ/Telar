import { Button, HStack, Host, ScrollView, Text as SwiftText } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, onTapGesture, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import type { GitChangeStatus, WorkspaceListing } from "@telar/engine-client";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { EmptyState, faded, Icon, Theme } from "../../ui";
import { FileTree } from "./FileTree";
import { FileView } from "./FileView";
import { buildFileTree, directoryPaths } from "./tree";

const SIDE_BY_SIDE = 560;
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function FileStrip({ files, active, treeShown, onTree, onActivate, onClose }: { files: string[]; active: string | undefined; treeShown: boolean; onTree: () => void; onActivate: (path: string) => void; onClose: (path: string) => void }) {
  return (
    <View>
      <Host matchContents={{ vertical: true }}>
        <HStack spacing={2} modifiers={[padding({ horizontal: 4 }), frame({ height: 34 }), background(Theme.sheet)]}>
          <Button onPress={onTree} modifiers={[buttonStyle("plain"), accessibilityLabel(treeShown ? "Hide tree" : "Show tree")]}>
            <Icon name={treeShown ? "sidebar.left" : "sidebar.leading"} size={12} color={Theme.textMuted} modifiers={[frame({ width: 28, height: 28 }), contentShape(shapes.rectangle())]} />
          </Button>
          <ScrollView axes="horizontal" showsIndicators={false}>
            <HStack spacing={2} modifiers={[padding({ horizontal: 4 })]}>
              {files.map((path) => {
                const current = path === active;
                return (
                  <HStack
                    key={path}
                    spacing={4}
                    modifiers={[padding({ horizontal: 8 }), frame({ height: 26 }), background(current ? Theme.subtleStrong : "transparent", shapes.roundedRectangle({ cornerRadius: 6 })), contentShape(shapes.rectangle()), onTapGesture(() => onActivate(path))]}
                  >
                    <SwiftText modifiers={[font({ textStyle: "footnote", weight: current ? "medium" : "regular" }), foregroundStyle(current ? Theme.text : Theme.textMuted), lineLimit(1)]}>{baseName(path)}</SwiftText>
                    <Button onPress={() => onClose(path)} modifiers={[buttonStyle("plain"), accessibilityLabel(`Close ${baseName(path)}`)]}>
                      <Icon name="xmark" textStyle="caption2" weight="semibold" color={Theme.textMuted} />
                    </Button>
                  </HStack>
                );
              })}
            </HStack>
          </ScrollView>
        </HStack>
      </Host>
      <View style={styles.rule} />
    </View>
  );
}

/** The session's checkout: a tree to browse, and the files opened from it as chips; side by side once the panel is wide. */
export function FilesSurface({ host, sessionId }: { host: HostConnection; sessionId: string }) {
  const [listing, setListing] = useState<WorkspaceListing>();
  const [error, setError] = useState<string>();
  const [statuses, setStatuses] = useState<ReadonlyMap<string, GitChangeStatus>>(new Map());
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>();
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState<string>();
  const [treeShown, setTreeShown] = useState(true);
  const [width, setWidth] = useState(0);
  const sideBySide = width >= SIDE_BY_SIDE;

  const load = useCallback(async () => {
    try {
      const { listing: read } = await host.call(true, () => host.client.sessionFiles(sessionId));
      setListing(read);
      setError(undefined);
      setExpanded((current) => current ?? new Set(directoryPaths(buildFileTree(read.files))));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
    try {
      const { diff } = await host.call(true, () => host.client.sessionDiff(sessionId));
      setStatuses(new Map(diff.files.map((file) => [file.path, file.status])));
    } catch {}
  }, [host, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    (path: string) => {
      if (query) return;
      setExpanded((current) => {
        const next = new Set(current);
        if (!next.delete(path)) next.add(path);
        return next;
      });
    },
    [query],
  );

  const open = useCallback(
    (path: string) => {
      setFiles((current) => (current.includes(path) ? current : [...current, path]));
      setActive(path);
      if (!sideBySide) setTreeShown(false);
    },
    [sideBySide],
  );

  const close = (path: string) => {
    const index = files.indexOf(path);
    const rest = files.filter((file) => file !== path);
    setFiles(rest);
    if (active === path) setActive(rest[Math.min(index, rest.length - 1)]);
  };

  const tree = (
    <FileTree
      listing={listing}
      error={error}
      statuses={statuses}
      query={query}
      expanded={expanded ?? new Set()}
      activePath={active}
      onQuery={setQuery}
      onToggle={toggle}
      onOpen={open}
      onRefresh={() => void load()}
    />
  );
  const body = active ? (
    <FileView key={`${sessionId}:${active}`} host={host} sessionId={sessionId} path={active} />
  ) : (
    <EmptyState icon="doc" title="No file open" detail={treeShown ? "Tap a file in the tree to look at it; press and hold for more." : "Show the tree to open a file."} />
  );

  return (
    <View style={styles.surface} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {files.length > 0 ? <FileStrip files={files} active={active} treeShown={treeShown} onTree={() => setTreeShown(!treeShown)} onActivate={setActive} onClose={close} /> : null}
      {sideBySide ? (
        <View style={styles.row}>
          {treeShown ? (
            <>
              <View style={styles.treeColumn}>{tree}</View>
              <View style={styles.columnRule} />
            </>
          ) : null}
          <View style={styles.fill}>{body}</View>
        </View>
      ) : treeShown || !active ? (
        tree
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: Theme.canvas },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: "row" },
  treeColumn: { width: 220 },
  columnRule: { width: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
});
