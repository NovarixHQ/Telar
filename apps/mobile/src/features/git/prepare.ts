import { highlightLines, languageFor } from "./highlight";
import { parsePatch, type PatchRow } from "./patch";
import { lineRuns, rowTokens } from "./runs";
import type { atomOne } from "./syntax";

export type Tone = keyof typeof atomOne | "text" | "sky" | "muted";
/** A styled run of code; `mark` is the word-diff highlight, by the side it belongs to. */
export type Piece = { text: string; tone: Tone; italic: boolean; bold: boolean; mark?: "add" | "del" };
export type Line = { kind: PatchRow["kind"]; old?: number; new?: number; pieces: Piece[] };
export type Band = { kind: PatchRow["kind"]; start: number; rows: number };

const CACHE_SIZE = 48;
const cache = new Map<string, Line[]>();

function toLine(row: PatchRow, runs: ReturnType<typeof lineRuns>): Line {
  const numbers = { ...("old" in row && row.old !== undefined ? { old: row.old } : {}), ...("new" in row && row.new !== undefined ? { new: row.new } : {}) };
  if (row.kind === "hunk" || row.kind === "note") {
    const text = row.kind === "note" ? `\\ ${row.text}` : row.text;
    return { kind: row.kind, ...numbers, pieces: [{ text, tone: row.kind === "hunk" ? "sky" : "muted", italic: false, bold: false }] };
  }
  const side = row.kind === "add" ? "add" : "del";
  const pieces = runs.map((run) => ({
    text: run.text,
    tone: run.style?.colour ?? ("text" as const),
    italic: run.style?.italic ?? false,
    bold: run.style?.bold ?? false,
    ...(run.marked ? { mark: side } : {}),
  })) satisfies Piece[];
  return { kind: row.kind, ...numbers, pieces };
}

/** A patch parsed, word-diffed and highlighted once, and kept while it is among the last few patches on screen. */
export function preparePatch(path: string, patch: string): Line[] {
  const key = `${path}\n${patch}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const rows = parsePatch(patch);
  const language = languageFor(path);
  const tokens = rowTokens(rows, (lines) => highlightLines(lines, language));
  const lines = rows.map((row, index) => toLine(row, row.kind === "hunk" || row.kind === "note" ? [] : lineRuns(row.text, tokens[index], row.changed)));
  cache.set(key, lines);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return lines;
}

const samePiece = (a: Piece, b: Piece) => a.tone === b.tone && a.italic === b.italic && a.bold === b.bold && a.mark === b.mark;
const plainBlank = (piece: Piece) => !piece.mark && /^\s*$/.test(piece.text);

/** Every line as one run of pieces split by newlines, merged wherever neighbours look alike, so a patch is one Text. */
export function textPieces(lines: Line[]): Piece[] {
  const out: Piece[] = [];
  const add = (piece: Piece) => {
    const last = out.at(-1);
    if (last && (samePiece(last, piece) || (plainBlank(piece) && !last.mark))) last.text += piece.text;
    else if (last && plainBlank(last) && !piece.mark) out[out.length - 1] = { ...piece, text: last.text + piece.text };
    else out.push({ ...piece });
  };
  lines.forEach((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : "";
    if (line.pieces.length === 0) add({ text: ` ${newline}`, tone: "text", italic: false, bold: false });
    else line.pieces.forEach((piece, at) => add(at === line.pieces.length - 1 ? { ...piece, text: piece.text + newline } : piece));
  });
  return out;
}

/** Runs of neighbouring tinted lines, so the tints are a few rectangles rather than one per line. */
export function bands(lines: Line[], tinted: (kind: PatchRow["kind"]) => boolean): Band[] {
  const out: Band[] = [];
  lines.forEach((line, index) => {
    if (!tinted(line.kind)) return;
    const last = out.at(-1);
    if (last && last.kind === line.kind && last.start + last.rows === index) last.rows++;
    else out.push({ kind: line.kind, start: index, rows: 1 });
  });
  return out;
}

export const numberColumn = (lines: Line[], side: "old" | "new") => lines.map((line) => (line[side] === undefined ? " " : String(line[side]))).join("\n");
