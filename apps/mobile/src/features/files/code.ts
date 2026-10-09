import { highlightLines, languageFor, lineRuns, textPieces, type Line, type Piece } from "../git";

const CODE_CHUNK = 40;
const TAB_STOP = 4;

function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const character of line) out += character === "\t" ? " ".repeat(TAB_STOP - (out.length % TAB_STOP)) : character;
  return out;
}

export function fileLines(text: string): string[] {
  const lines = text.split("\n").map(expandTabs);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** A file highlighted as one block, cut into chunks of styled runs, one Text each. */
export function codeChunks(path: string, lines: string[]): Piece[][] {
  const tokens = highlightLines(lines, languageFor(path));
  const rows: Line[] = lines.map((text, index) => ({
    kind: "ctx",
    pieces: lineRuns(text, tokens?.[index]).map((run) => ({ text: run.text, tone: run.style?.colour ?? "text", italic: run.style?.italic ?? false, bold: run.style?.bold ?? false })),
  }));
  const chunks: Piece[][] = [];
  for (let start = 0; start < rows.length; start += CODE_CHUNK) chunks.push(textPieces(rows.slice(start, start + CODE_CHUNK)));
  return chunks;
}
