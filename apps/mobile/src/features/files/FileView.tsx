import { HStack, Host, Spacer, Text as SwiftText } from "@expo/ui/swift-ui";
import { background, font, foregroundStyle, frame, lineLimit, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import type { WorkspaceFile } from "@telar/engine-client";
import { memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, DynamicColorIOS, PixelRatio, ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { EmptyState, faded, Icon, Theme } from "../../ui";
import { atomOne, type Piece, type Tone } from "../git";
import { codeChunks, fileLines } from "./code";
import { fileGlyph, humanBytes, isProse } from "./tree";

const SCALE = PixelRatio.getFontScale();
const LINE = Math.round(17.5 * SCALE);
const DIGIT = 0.6 * 12 * SCALE;

const syntax = Object.fromEntries(Object.entries(atomOne).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<keyof typeof atomOne, ColorValue>;
const toneColour = (tone: Tone): ColorValue => (tone === "text" ? Theme.text : tone === "sky" ? Theme.sky : tone === "muted" ? Theme.textMuted : syntax[tone]);

function AddressRow({ path, detail }: { path: string; detail?: string | undefined }) {
  return (
    <View>
      <Host matchContents={{ vertical: true }}>
        <HStack spacing={8} modifiers={[padding({ horizontal: 10 }), frame({ minHeight: 30 }), background(Theme.sheet)]}>
          <Icon name={fileGlyph(path)} textStyle="caption" color={Theme.textMuted} />
          <SwiftText modifiers={[font({ textStyle: "caption", design: "monospaced" }), foregroundStyle(Theme.textMuted), lineLimit(1), truncationMode("head")]}>{path}</SwiftText>
          <Spacer minLength={4} />
          {detail ? <SwiftText modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.textMuted)]}>{detail}</SwiftText> : null}
        </HStack>
      </Host>
      <View style={styles.rule} />
    </View>
  );
}

const Chunk = memo(function Chunk({ pieces }: { pieces: Piece[] }) {
  return (
    <Text style={styles.code} selectable>
      {pieces.map((piece, index) => (
        <Text key={index} style={{ color: toneColour(piece.tone), ...(piece.italic ? { fontStyle: "italic" } : {}), ...(piece.bold ? { fontWeight: "700" } : {}) }}>
          {piece.text}
        </Text>
      ))}
    </Text>
  );
});

/** Line numbers stay put while the code scrolls sideways; chunks mount one per frame so a long file never stalls a frame. */
function Code({ path, text }: { path: string; text: string }) {
  const lines = useMemo(() => fileLines(text), [text]);
  const chunks = useMemo(() => codeChunks(path, lines), [path, lines]);
  const numbers = useMemo(() => lines.map((_, index) => index + 1).join("\n"), [lines]);
  const [grown, setGrown] = useState(1);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    if (grown >= chunks.length) return;
    const timer = setTimeout(() => setGrown((current) => current + 1), 16);
    return () => clearTimeout(timer);
  }, [grown, chunks.length]);
  const gutter = Math.max(2, String(lines.length).length) * DIGIT + 16;
  return (
    <ScrollView style={styles.codeScroll} contentContainerStyle={styles.codeBody}>
      <Text style={[styles.number, { width: gutter }]}>{numbers}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} onLayout={(event) => setViewport(event.nativeEvent.layout.width)}>
        <View style={{ minWidth: viewport, height: lines.length * LINE }}>
          {chunks.slice(0, grown).map((pieces, index) => (
            <Chunk key={index} pieces={pieces} />
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

/** One checkout file, read-only: code with line numbers and syntax colours, prose as wrapped text. */
export function FileView({ host, sessionId, path }: { host: HostConnection; sessionId: string; path: string }) {
  const [file, setFile] = useState<WorkspaceFile>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    host
      .call(true, () => host.client.sessionFile(sessionId, path))
      .then(({ file: read }) => live && setFile(read))
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
  }, [host, sessionId, path]);

  const prose = isProse(path);
  return (
    <View style={styles.fill}>
      <AddressRow path={path} detail={file ? humanBytes(file.bytes) : undefined} />
      {file?.binary ? (
        <EmptyState icon="doc.zipper" title="Binary file" detail={`${humanBytes(file.bytes)} of bytes rather than text, so nothing was sent to read.`} />
      ) : file && prose ? (
        <ScrollView style={styles.proseScroll}>
          <Text selectable style={[styles.prose, path.toLowerCase().endsWith(".md") ? null : styles.proseMono]}>
            {file.text}
          </Text>
        </ScrollView>
      ) : file ? (
        <View style={styles.fill}>
          {file.truncated ? <Text style={styles.truncated}>{`Truncated: the first ${humanBytes(file.text.length)} of ${humanBytes(file.bytes)}.`}</Text> : null}
          <Code path={path} text={file.text} />
        </View>
      ) : error ? (
        <EmptyState icon="xmark.circle" title="Could not read this file" detail={error} />
      ) : (
        <ActivityIndicator style={styles.fill} />
      )}
    </View>
  );
}

const mono = { fontFamily: "ui-monospace", lineHeight: LINE } as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  codeScroll: { flex: 1, backgroundColor: Theme.codeBackground },
  codeBody: { flexDirection: "row", paddingVertical: 8 },
  number: { ...mono, fontSize: 12, textAlign: "right", paddingRight: 8, color: Theme.textMuted },
  code: { ...mono, fontSize: 13, color: Theme.text, paddingHorizontal: 4 },
  truncated: { fontSize: 12, color: Theme.amber, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Theme.codeBackground },
  proseScroll: { flex: 1, backgroundColor: Theme.canvas },
  prose: { fontSize: 15, lineHeight: 21, color: Theme.text, paddingHorizontal: 11, paddingVertical: 8 },
  proseMono: { fontFamily: "ui-monospace" },
});
