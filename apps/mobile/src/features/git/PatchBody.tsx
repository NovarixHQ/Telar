import type { GitFileChange, GitFilePatch } from "@telar/engine-client";
import { memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, DynamicColorIOS, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Theme } from "../../ui";
import type { PatchRow } from "./patch";
import { bands, numberColumn, preparePatch, textPieces, type Line, type Piece, type Tone } from "./prepare";
import { atomOne } from "./syntax";

const LINE_CAP = 400;
const PATCH_CACHE = 64;
// Swift scales its 17pt row with the caption style; RN scales fonts and lineHeight by the same factor.
const ROW = 17 * PixelRatio.getFontScale();
const DIGIT_ADVANCE = 0.6 * 11 * PixelRatio.getFontScale();

const syntax = Object.fromEntries(Object.entries(atomOne).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<keyof typeof atomOne, ColorValue>;
const toneColour = (tone: Tone): ColorValue => (tone === "text" ? Theme.text : tone === "sky" ? Theme.sky : tone === "muted" ? Theme.textMuted : syntax[tone]);
const TINT: Partial<Record<PatchRow["kind"], ColorValue>> = { add: faded("emerald", 0.1), del: faded("red", 0.1), hunk: faded("sky", 0.06) };
const MARK = { add: faded("emerald", 0.3), del: faded("red", 0.3) };

const patches = new Map<string, GitFilePatch>();
function remember(key: string, patch: GitFilePatch) {
  patches.delete(key);
  patches.set(key, patch);
  if (patches.size > PATCH_CACHE) patches.delete(patches.keys().next().value!);
}

function Tints({ lines }: { lines: Line[] }) {
  return bands(lines, (kind) => kind in TINT).map((band) => <View key={band.start} style={[styles.band, { top: band.start * ROW, height: band.rows * ROW, backgroundColor: TINT[band.kind] }]} />);
}

function pieceStyle(piece: Piece) {
  return { color: toneColour(piece.tone), ...(piece.italic ? { fontStyle: "italic" as const } : {}), ...(piece.bold ? { fontWeight: "700" as const } : {}), ...(piece.mark ? { backgroundColor: MARK[piece.mark] } : {}) };
}

/** The gutter stays put while the code scrolls sideways under it. Each column is one text view, however long the patch. */
const PatchRows = memo(function PatchRows({ lines }: { lines: Line[] }) {
  const [viewport, setViewport] = useState(0);
  const pieces = useMemo(() => textPieces(lines), [lines]);
  const old = useMemo(() => numberColumn(lines, "old"), [lines]);
  const next = useMemo(() => numberColumn(lines, "new"), [lines]);
  const digits = String(lines.reduce((most, line) => Math.max(most, line.old ?? 0, line.new ?? 0), 0)).length;
  const column = digits * DIGIT_ADVANCE + 6;
  return (
    <View style={styles.block}>
      <View style={{ width: column * 2 + 4 }}>
        <Tints lines={lines} />
        <View style={styles.gutter}>
          <Text style={[styles.number, { width: column }]}>{old}</Text>
          <Text style={[styles.number, { width: column }]}>{next}</Text>
        </View>
      </View>
      <View style={styles.rule} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} onLayout={(event) => setViewport(event.nativeEvent.layout.width)}>
        <View style={{ minWidth: viewport }}>
          <Tints lines={lines} />
          <Text style={styles.code} selectable>
            {pieces.map((piece, index) => (
              <Text key={index} style={pieceStyle(piece)}>
                {piece.text}
              </Text>
            ))}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
});

const Caption = ({ text, colour = Theme.textMuted }: { text: string; colour?: ColorValue }) => <Text style={[styles.caption, { color: colour }]}>{text}</Text>;

function noteFor(file: GitFileChange, patch: GitFilePatch): string | undefined {
  if (file.binary || patch.binary) return "Binary file — no text diff to show.";
  if (patch.incomplete === "timeout") return "git did not answer in time — pull to try again.";
  if (patch.incomplete === "failed") return "git could not produce a diff for this file.";
  return undefined;
}

/** Rows the patch will likely take, so the list keeps its height steady before the patch arrives. */
const estimatedPatchHeight = (file: GitFileChange) => (file.binary ? 20 : Math.min((file.linesAdded ?? 0) + (file.linesRemoved ?? 0) + 7, LINE_CAP) * ROW);

/** One file's patch. The list mounts it only near the screen, so a patch is read and highlighted only once it is about to show. */
export const PatchBody = memo(function PatchBody({ host, sessionId, file, generation }: { host: HostConnection; sessionId: string; file: GitFileChange; generation: number }) {
  const key = `${sessionId}\n${file.path}\n${generation}`;
  const [patch, setPatch] = useState(() => patches.get(key));
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (file.binary || patches.has(key)) return;
    let live = true;
    host
      .call(true, () => host.client.sessionFilePatch(sessionId, file.path, file.status === "untracked" ? { untracked: true } : {}))
      .then(({ file: read }) => {
        remember(key, read);
        if (live) setPatch(read);
      })
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
  }, [host, sessionId, file, key]);

  const note = patch && noteFor(file, patch);
  const lines = useMemo(() => (patch && !note ? preparePatch(file.path, patch.patch) : []), [patch, note, file.path]);
  const shown = showAll ? lines.length : Math.min(lines.length, LINE_CAP);
  const visible = useMemo(() => (shown === lines.length ? lines : lines.slice(0, shown)), [lines, shown]);

  if (file.binary) return <Caption text="Binary file — no text diff to show." />;
  if (!patch) return error ? <Caption text={error} colour={Theme.red} /> : <ActivityIndicator style={{ height: estimatedPatchHeight(file) }} />;
  if (note) return <Caption text={note} />;
  if (lines.length === 0) return <Caption text="No textual difference." />;
  return (
    <View style={styles.body}>
      <PatchRows lines={visible} />
      {shown < lines.length ? (
        <Pressable accessibilityRole="button" onPress={() => setShowAll(true)}>
          <Text style={[styles.caption, styles.more]}>{`Show ${lines.length - shown} more lines`}</Text>
        </Pressable>
      ) : null}
      {patch.incomplete === "truncated" ? <Caption text="git cut this diff short." /> : null}
    </View>
  );
});

const mono = { fontFamily: "ui-monospace", lineHeight: 17 } as const;

const styles = StyleSheet.create({
  body: { gap: 6 },
  block: { flexDirection: "row", backgroundColor: Theme.codeBackground, borderRadius: 8, borderCurve: "continuous", overflow: "hidden" },
  gutter: { flexDirection: "row", paddingRight: 4 },
  number: { ...mono, fontSize: 11, textAlign: "right", color: faded("textMuted", 0.8) },
  rule: { width: 1, backgroundColor: faded("border", 0.6) },
  band: { position: "absolute", left: 0, right: 0 },
  code: { ...mono, fontSize: 12, color: Theme.text, paddingHorizontal: 6 },
  caption: { fontSize: 12, color: Theme.textMuted },
  more: { fontWeight: "500" },
});
