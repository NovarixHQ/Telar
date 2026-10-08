import { Button, HStack, ProgressView, Rectangle, ScrollView, Text, VStack } from "@expo/ui/swift-ui";
import { background, bold, buttonStyle, clipShape, fixedSize, font, foregroundStyle, frame, italic, lineLimit, onGeometryChange, padding, textSelection } from "@expo/ui/swift-ui/modifiers";
import type { GitFileChange, GitFilePatch } from "@telar/engine-client";
import { useEffect, useMemo, useState } from "react";
import { DynamicColorIOS, type ColorValue } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Theme, Type } from "../../ui";
import { highlightLines, languageFor } from "./highlight";
import { parsePatch, type PatchRow } from "./patch";
import { lineRuns, rowTokens, type Run } from "./runs";
import { atomOne } from "./syntax";

const LINE_CAP = 400;
const ROW_HEIGHT = 17;
const DIGIT_ADVANCE = 6.6;
const code = font({ textStyle: "caption", design: "monospaced" });
const syntaxColour = Object.fromEntries(Object.entries(atomOne).map(([name, pair]) => [name, DynamicColorIOS(pair)])) as Record<keyof typeof atomOne, ColorValue>;

function tint(kind: PatchRow["kind"]): ColorValue | undefined {
  if (kind === "add") return faded("emerald", 0.1);
  if (kind === "del") return faded("red", 0.1);
  if (kind === "hunk") return faded("sky", 0.06);
  return undefined;
}

const tinted = (kind: PatchRow["kind"]) => {
  const colour = tint(kind);
  return colour ? [background(colour)] : [];
};

function runModifiers(run: Run, mark: ColorValue | undefined) {
  return [
    foregroundStyle(run.style ? syntaxColour[run.style.colour] : Theme.text),
    ...(run.style?.italic ? [italic()] : []),
    ...(run.style?.bold ? [bold()] : []),
    ...(mark && run.marked ? [background(mark)] : []),
  ];
}

function CodeLine({ row, runs }: { row: PatchRow; runs: Run[] }) {
  const frameRow = [padding({ horizontal: 6 }), frame({ maxWidth: Infinity, minHeight: ROW_HEIGHT, maxHeight: ROW_HEIGHT, alignment: "leading" }), ...tinted(row.kind)];
  if (row.kind === "hunk" || row.kind === "note") {
    const text = row.kind === "note" ? `\\ ${row.text}` : row.text;
    return <Text modifiers={[code, foregroundStyle(row.kind === "hunk" ? Theme.sky : Theme.textMuted), lineLimit(1), fixedSize(), ...frameRow]}>{text}</Text>;
  }
  const mark = runs.some((run) => run.marked) ? faded(row.kind === "add" ? "emerald" : "red", 0.3) : undefined;
  if (mark) {
    return (
      <HStack spacing={0} modifiers={frameRow}>
        {runs.map((run, index) => (
          <Text key={index} modifiers={[code, lineLimit(1), fixedSize(), ...runModifiers(run, mark)]}>
            {run.text}
          </Text>
        ))}
      </HStack>
    );
  }
  if (runs.length === 0) return <Text modifiers={[code, ...frameRow]}> </Text>;
  return (
    <Text modifiers={[code, lineLimit(1), fixedSize(), ...frameRow]}>
      {runs.map((run, index) => (
        <Text key={index} modifiers={runModifiers(run, undefined)}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

function LineNumber({ value, width }: { value: number | undefined; width: number }) {
  return <Text modifiers={[font({ textStyle: "caption2", design: "monospaced" }), foregroundStyle(faded("textMuted", 0.8)), frame({ width, alignment: "trailing" })]}>{value === undefined ? "" : String(value)}</Text>;
}

/** The gutter stays put while the code scrolls sideways under it. */
function PatchRows({ rows, path }: { rows: PatchRow[]; path: string }) {
  const [viewport, setViewport] = useState(0);
  const runs = useMemo(() => {
    const language = languageFor(path);
    const tokens = rowTokens(rows, (lines) => highlightLines(lines, language));
    return rows.map((row, index) => (row.kind === "hunk" || row.kind === "note" ? [] : lineRuns(row.text, tokens[index], row.changed)));
  }, [rows, path]);
  const digits = String(rows.reduce((most, row) => Math.max(most, "old" in row ? (row.old ?? 0) : 0, "new" in row ? (row.new ?? 0) : 0), 0)).length;
  const column = digits * DIGIT_ADVANCE + 6;
  return (
    <HStack alignment="top" spacing={0} modifiers={[background(Theme.codeBackground), clipShape("roundedRectangle", 8), textSelection(true)]}>
      <VStack alignment="trailing" spacing={0}>
        {rows.map((row, index) => (
          <HStack key={index} spacing={0} modifiers={[padding({ trailing: 4 }), frame({ height: ROW_HEIGHT }), ...tinted(row.kind)]}>
            <LineNumber value={"old" in row ? row.old : undefined} width={column} />
            <LineNumber value={"new" in row ? row.new : undefined} width={column} />
          </HStack>
        ))}
      </VStack>
      <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ width: 1, height: rows.length * ROW_HEIGHT })]} />
      <ScrollView axes="horizontal" showsIndicators={false} modifiers={[onGeometryChange(({ width }) => setViewport(width))]}>
        <VStack alignment="leading" spacing={0} modifiers={[frame({ minWidth: viewport, alignment: "leading" })]}>
          {rows.map((row, index) => (
            <CodeLine key={index} row={row} runs={runs[index]!} />
          ))}
        </VStack>
      </ScrollView>
    </HStack>
  );
}

const Caption = ({ text, colour = Theme.textMuted }: { text: string; colour?: ColorValue }) => <Text modifiers={[Type.meta, foregroundStyle(colour)]}>{text}</Text>;

function noteFor(file: GitFileChange, patch: GitFilePatch): string | undefined {
  if (file.binary || patch.binary) return "Binary file — no text diff to show.";
  if (patch.incomplete === "timeout") return "git did not answer in time — pull to try again.";
  if (patch.incomplete === "failed") return "git could not produce a diff for this file.";
  return undefined;
}

/** One file's patch, read when it opens and again on every `generation`. */
export function PatchBody({ host, sessionId, file, generation }: { host: HostConnection; sessionId: string; file: GitFileChange; generation: number }) {
  const [patch, setPatch] = useState<GitFilePatch>();
  const [error, setError] = useState<string>();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (file.binary) return;
    let live = true;
    host
      .call(true, () => host.client.sessionFilePatch(sessionId, file.path, file.status === "untracked" ? { untracked: true } : {}))
      .then(({ file: read }) => {
        if (!live) return;
        setPatch(read);
        setError(undefined);
      })
      .catch((failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)));
    return () => {
      live = false;
    };
  }, [host, sessionId, file.path, file.status, file.binary, generation]);
  const rows = useMemo(() => (patch ? parsePatch(patch.patch) : []), [patch]);
  const shown = showAll ? rows.length : Math.min(rows.length, LINE_CAP);
  const visible = useMemo(() => (shown === rows.length ? rows : rows.slice(0, shown)), [rows, shown]);

  if (file.binary) return <Caption text="Binary file — no text diff to show." />;
  if (!patch) return error ? <Caption text={error} colour={Theme.red} /> : <ProgressView modifiers={[frame({ maxWidth: Infinity })]} />;
  const note = noteFor(file, patch);
  if (note) return <Caption text={note} />;
  if (rows.length === 0) return <Caption text="No textual difference." />;
  return (
    <VStack alignment="leading" spacing={6}>
      <PatchRows rows={visible} path={file.path} />
      {shown < rows.length ? <Button label={`Show ${rows.length - shown} more lines`} onPress={() => setShowAll(true)} modifiers={[buttonStyle("borderless"), font({ textStyle: "caption", weight: "medium" }), foregroundStyle(Theme.textMuted)]} /> : null}
      {patch.incomplete === "truncated" ? <Caption text="git cut this diff short." /> : null}
    </VStack>
  );
}
