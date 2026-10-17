// The draft is plain text only; a chip is a way of drawing a run of it, never
// something stored beside it, so what the agent receives is the typed string.
import type { TelarReference } from "@telar/client/composer";

type ComposerTriggerKind = "path" | "command" | "skill";

export type ComposerTrigger = {
  kind: ComposerTriggerKind;
  query: string;
  /** The half-open range the accepted candidate replaces, sigil included. */
  rangeStart: number;
  rangeEnd: number;
};

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

/**
 * `/` is anchored to the start of a line (so "9/10" never opens a menu), `@` is not,
 * and `$` must start a word and not be `${` so shell snippets don't trigger it.
 */
export function detectComposerTrigger(text: string, cursorInput: number): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineStart = text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const linePrefix = text.slice(lineStart, cursor);

  // The whole line after the slash is the query, spaces included, so `/model op` narrows multi-word rows.
  const command = /^\/([^\n]*)$/.exec(linePrefix);
  if (command) return { kind: "command", query: command[1] ?? "", rangeStart: lineStart, rangeEnd: cursor };

  let index = cursor - 1;
  while (index >= 0 && !isWhitespace(text[index] ?? "")) index -= 1;
  const tokenStart = index + 1;
  const token = text.slice(tokenStart, cursor);
  if (token.startsWith("@")) return { kind: "path", query: token.slice(1), rangeStart: tokenStart, rangeEnd: cursor };
  // The token scan walks back to whitespace, so a `$` mid-token (`PATH=$HOME`) never matches.
  if (token.startsWith("$") && !token.startsWith("${")) {
    return { kind: "skill", query: token.slice(1), rangeStart: tokenStart, rangeEnd: cursor };
  }
  return null;
}

/** Splice a replacement into a draft and return where the caret lands. */
export function replaceTextRange(text: string, rangeStart: number, rangeEnd: number, replacement: string): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  return { text: `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`, cursor: safeStart + replacement.length };
}
