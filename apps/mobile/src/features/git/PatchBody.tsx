import { Button, HStack, ProgressView, Rectangle, ScrollView, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  background,
  bold,
  buttonStyle,
  clipShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  italic,
  lineHeight,
  multilineTextAlignment,
  onAppear,
  onDisappear,
  onGeometryChange,
  padding,
  textSelection,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import type { GitFileChange, GitFilePatch } from "@telar/engine-client";
import { memo, useEffect, useMemo, useState } from "react";
import { DynamicColorIOS, Platform, type ColorValue } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Theme, Type } from "../../ui";
import type { PatchRow } from "./patch";
import { bands, numberColumn, preparePatch, textPieces, type Line, type Piece, type Tone } from "./prepare";
import { atomOne } from "./syntax";

const LINE_CAP = 400;
const ROW_HEIGHT = 17;
const DIGIT_ADVANCE = 6.6;
const code = font({ textStyle: "caption", design: "monospaced" });
const CLEAR = "#00000000";
// `lineHeight` is iOS 26+; before it each line is its own Text pinned to the row height.
// A lineHeight Text whose line is empty lays out with a NaN frame and crashes the List, so empty lines carry a space.
const EXACT_LINES = Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;
const fill = (height: number) => frame({ minWidth: 0, maxWidth: Infinity, minHeight: height, maxHeight: height });

const syntax = Object.fromEntries(Object.entries(atomOne).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<keyof typeof atomOne, ColorValue>;
const toneColour = (tone: Tone): ColorValue => (tone === "text" ? Theme.text : tone === "sky" ? Theme.sky : tone === "muted" ? Theme.textMuted : syntax[tone]);

const TINT: Partial<Record<PatchRow["kind"], ColorValue>> = { add: faded("emerald", 0.1), del: faded("red", 0.1), hunk: faded("sky", 0.06) };
const MARK: Partial<Record<PatchRow["kind"], ColorValue>> = { add: faded("emerald", 0.3), del: faded("red", 0.3) };

function Tints({ lines }: { lines: Line[] }) {
  return (
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: "top" })]}>
      {bands(lines, (kind) => kind in TINT).map((band, index) => (
        <Rectangle key={index} modifiers={[foregroundStyle(TINT[band.kind] ?? CLEAR), fill(band.rows * ROW_HEIGHT)]} />
      ))}
    </VStack>
  );
}

/** Word-diff marks drawn under the code: the same runs in clear ink, so each mark lands exactly on its characters. */
function Marks({ lines }: { lines: Line[] }) {
  const groups: { start: number; rows: number; line?: Line }[] = [];
  lines.forEach((line, index) => {
    const last = groups.at(-1);
    if (line.marks.length > 0) groups.push({ start: index, rows: 1, line });
    else if (last && !last.line) last.rows++;
    else groups.push({ start: index, rows: 1 });
  });
  return (
    <VStack alignment="leading" spacing={0}>
      {groups.map((group) =>
        group.line ? (
          <HStack key={group.start} spacing={0} modifiers={[padding({ horizontal: 6 }), frame({ height: ROW_HEIGHT })]}>
            {group.line.marks.map((mark, index) => (
              <Text key={index} modifiers={[code, foregroundStyle(CLEAR), fixedSize(), ...(mark.marked ? [background(MARK[group.line!.kind] ?? CLEAR)] : [])]}>
                {mark.text}
              </Text>
            ))}
          </HStack>
        ) : (
          <Rectangle key={group.start} modifiers={[foregroundStyle(CLEAR), frame({ width: 1, height: group.rows * ROW_HEIGHT })]} />
        ),
      )}
    </VStack>
  );
}

function Pieces({ pieces, modifiers }: { pieces: Piece[]; modifiers: ModifierConfig[] }) {
  return (
    <Text modifiers={modifiers}>
      {pieces.map((piece, index) => (
        <Text key={index} modifiers={[foregroundStyle(toneColour(piece.tone)), ...(piece.italic ? [italic()] : []), ...(piece.bold ? [bold()] : [])]}>
          {piece.text}
        </Text>
      ))}
    </Text>
  );
}

const row = frame({ height: ROW_HEIGHT, alignment: "leading" });

function Code({ lines }: { lines: Line[] }) {
  const pieces = useMemo(() => (EXACT_LINES ? [textPieces(lines)] : lines.map((line) => textPieces([line]))), [lines]);
  if (EXACT_LINES) return <Pieces pieces={pieces[0]!} modifiers={[code, lineHeight(ROW_HEIGHT), fixedSize(), padding({ horizontal: 6 })]} />;
  return (
    <VStack alignment="leading" spacing={0}>
      {pieces.map((line, index) => (
        <Pieces key={index} pieces={line} modifiers={[code, fixedSize(), padding({ horizontal: 6 }), row]} />
      ))}
    </VStack>
  );
}

function Numbers({ lines, side, width }: { lines: Line[]; side: "old" | "new"; width: number }) {
  const column = useMemo(() => numberColumn(lines, side), [lines, side]);
  const style = [font({ textStyle: "caption2", design: "monospaced" }), foregroundStyle(faded("textMuted", 0.8))];
  if (EXACT_LINES) return <Text modifiers={[...style, lineHeight(ROW_HEIGHT), multilineTextAlignment("trailing"), fixedSize(), frame({ width, alignment: "topTrailing" })]}>{column}</Text>;
  return (
    <VStack alignment="trailing" spacing={0} modifiers={[frame({ width, alignment: "topTrailing" })]}>
      {column.split("\n").map((value, index) => (
        <Text key={index} modifiers={[...style, frame({ height: ROW_HEIGHT })]}>{value}</Text>
      ))}
    </VStack>
  );
}

/** The gutter stays put while the code scrolls sideways under it. Each column is one Text, so a long patch is a handful of views. */
const PatchRows = memo(function PatchRows({ lines }: { lines: Line[] }) {
  const [viewport, setViewport] = useState(0);
  const digits = String(lines.reduce((most, line) => Math.max(most, line.old ?? 0, line.new ?? 0), 0)).length;
  const width = digits * DIGIT_ADVANCE + 6;
  const height = lines.length * ROW_HEIGHT;
  return (
    <HStack alignment="top" spacing={0} modifiers={[background(Theme.codeBackground), clipShape("roundedRectangle", 8), textSelection(true)]}>
      <ZStack alignment="topLeading" modifiers={[frame({ width: width * 2 + 4, height, alignment: "topLeading" })]}>
        <Tints lines={lines} />
        <HStack alignment="top" spacing={0} modifiers={[padding({ trailing: 4 })]}>
          <Numbers lines={lines} side="old" width={width} />
          <Numbers lines={lines} side="new" width={width} />
        </HStack>
      </ZStack>
      <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ width: 1, height })]} />
      <ScrollView axes="horizontal" showsIndicators={false} modifiers={[onGeometryChange(({ width: next }) => setViewport(next))]}>
        <ZStack alignment="topLeading" modifiers={[frame({ minWidth: viewport, minHeight: height, maxHeight: height, alignment: "topLeading" })]}>
          <Tints lines={lines} />
          <Marks lines={lines} />
          <Code lines={lines} />
        </ZStack>
      </ScrollView>
    </HStack>
  );
});

const Caption = ({ text, colour = Theme.textMuted }: { text: string; colour?: ColorValue }) => <Text modifiers={[Type.meta, foregroundStyle(colour)]}>{text}</Text>;

function noteFor(file: GitFileChange, patch: GitFilePatch): string | undefined {
  if (file.binary || patch.binary) return "Binary file — no text diff to show.";
  if (patch.incomplete === "timeout") return "git did not answer in time — pull to try again.";
  if (patch.incomplete === "failed") return "git could not produce a diff for this file.";
  return undefined;
}

type Read = { patch: GitFilePatch; lines: Line[] };

/** One file's patch. It is read the first time its row scrolls into view, as Swift's `.task` does, and its views are dropped while off screen. */
export function PatchBody({ host, sessionId, file, generation }: { host: HostConnection; sessionId: string; file: GitFileChange; generation: number }) {
  const [seen, setSeen] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [height, setHeight] = useState(0);
  const [read, setRead] = useState<Read>();
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (file.binary || !seen) return;
    let live = true;
    host
      .call(true, () => host.client.sessionFilePatch(sessionId, file.path, file.status === "untracked" ? { untracked: true } : {}))
      .then(({ file: patch }) => {
        if (!live) return;
        setRead({ patch, lines: noteFor(file, patch) ? [] : preparePatch(file.path, patch.patch) });
        setError(undefined);
      })
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
  }, [host, sessionId, file, seen, generation]);

  const lines = read?.lines ?? [];
  const shown = showAll ? lines.length : Math.min(lines.length, LINE_CAP);
  const visible = useMemo(() => (shown === lines.length ? lines : lines.slice(0, shown)), [lines, shown]);
  const watch = [
    onAppear(() => {
      setSeen(true);
      setOnScreen(true);
    }),
    onDisappear(() => setOnScreen(false)),
  ];

  if (file.binary) return <Caption text="Binary file — no text diff to show." />;
  if (!read) return error ? <Caption text={error} colour={Theme.red} /> : <ProgressView modifiers={[frame({ maxWidth: Infinity }), ...watch]} />;
  const note = noteFor(file, read.patch);
  if (note) return <Caption text={note} />;
  if (lines.length === 0) return <Caption text="No textual difference." />;
  if (!onScreen && height > 0) return <Rectangle modifiers={[foregroundStyle(CLEAR), fill(height), ...watch]} />;
  return (
    <VStack alignment="leading" spacing={6} modifiers={[...watch, onGeometryChange(({ height: next }) => setHeight(next))]}>
      <PatchRows lines={visible} />
      {shown < lines.length ? <Button label={`Show ${lines.length - shown} more lines`} onPress={() => setShowAll(true)} modifiers={[buttonStyle("borderless"), font({ textStyle: "caption", weight: "medium" }), foregroundStyle(Theme.textMuted)]} /> : null}
      {read.patch.incomplete === "truncated" ? <Caption text="git cut this diff short." /> : null}
    </VStack>
  );
}
