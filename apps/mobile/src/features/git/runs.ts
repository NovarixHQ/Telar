import type { Token } from "./highlight";
import { patchSides, type PatchRow } from "./patch";
import { syntaxStyle, type SyntaxStyle } from "./syntax";
import type { Span } from "./word-diff";

/** A piece of one code line: its syntax style (none when unhighlighted) and whether the word diff marks it. */
export type Run = { text: string; style?: SyntaxStyle; marked: boolean };

/** Cuts a line at every token and changed-span edge. Tokens that don't spell the line are ignored. */
export function lineRuns(text: string, tokens: Token[] | undefined, changed: Span[] = []): Run[] {
  const pieces = tokens && tokens.map((token) => token.text).join("") === text ? tokens : [{ text, scopes: undefined }];
  const runs: Run[] = [];
  let at = 0;
  for (const piece of pieces) {
    const end = at + piece.text.length;
    const cuts = new Set([at, end]);
    for (const span of changed) for (const edge of [span.start, span.end]) if (edge > at && edge < end) cuts.add(edge);
    const edges = [...cuts].sort((a, b) => a - b);
    for (let index = 0; index + 1 < edges.length; index++) {
      const start = edges[index]!;
      const stop = edges[index + 1]!;
      const marked = changed.some((span) => span.start <= start && stop <= span.end);
      runs.push({ text: text.slice(start, stop), ...(piece.scopes ? { style: syntaxStyle(piece.scopes) } : {}), marked });
    }
    at = end;
  }
  return runs;
}

/** Each code row's tokens, read from the highlighted old and new sides: removed rows from old, the rest from new. */
export function rowTokens(rows: PatchRow[], highlight: (lines: string[]) => Token[][] | undefined): (Token[] | undefined)[] {
  const sides = patchSides(rows);
  const old = highlight(sides.old);
  const next = highlight(sides.new);
  let oldIndex = 0;
  let newIndex = 0;
  return rows.map((row) => {
    if (row.kind === "del") return old?.[oldIndex++];
    if (row.kind === "add") return next?.[newIndex++];
    if (row.kind === "ctx") {
      oldIndex++;
      return next?.[newIndex++];
    }
    return undefined;
  });
}
