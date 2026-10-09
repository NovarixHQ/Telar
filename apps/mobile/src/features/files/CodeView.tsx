import { memo, useEffect, useMemo, useState } from "react";
import { DynamicColorIOS, PixelRatio, ScrollView, StyleSheet, Text, TextInput, View, type ColorValue } from "react-native";
import { Theme } from "../../ui";
import { atomOne, type Piece, type Tone } from "../git";
import { codeChunks, fileLines } from "./code";

const SCALE = PixelRatio.getFontScale();
const LINE = Math.round(17.5 * SCALE);
const DIGIT = 0.6 * 12 * SCALE;

const syntax = Object.fromEntries(Object.entries(atomOne).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<keyof typeof atomOne, ColorValue>;
const toneColour = (tone: Tone): ColorValue => (tone === "text" ? Theme.text : tone === "sky" ? Theme.sky : tone === "muted" ? Theme.textMuted : syntax[tone]);

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
export function CodeView({ path, text }: { path: string; text: string }) {
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

/** The editable text: monospaced for code, the system face for Markdown. A text field wraps, so it has no line gutter. */
export function TextEditor({ text, onChange, kind, autoFocus = false }: { text: string; onChange: (next: string) => void; kind: "code" | "prose" | "markdown"; autoFocus?: boolean }) {
  return (
    <TextInput
      value={text}
      onChangeText={onChange}
      multiline
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      smartInsertDelete={false}
      textAlignVertical="top"
      style={[styles.editor, kind === "code" ? styles.codeEditor : kind === "prose" ? styles.monoProse : null]}
    />
  );
}

const mono = { fontFamily: "ui-monospace", lineHeight: LINE } as const;

const styles = StyleSheet.create({
  codeScroll: { flex: 1, backgroundColor: Theme.codeBackground },
  codeBody: { flexDirection: "row", paddingVertical: 8 },
  number: { ...mono, fontSize: 12, textAlign: "right", paddingRight: 8, color: Theme.textMuted },
  code: { ...mono, fontSize: 13, color: Theme.text, paddingHorizontal: 4 },
  editor: { flex: 1, fontSize: 15, lineHeight: 21, color: Theme.text, backgroundColor: Theme.canvas, paddingHorizontal: 11, paddingTop: 8, paddingBottom: 8 },
  codeEditor: { ...mono, fontSize: 13, backgroundColor: Theme.codeBackground },
  monoProse: { fontFamily: "ui-monospace" },
});
