import type { PluginDecorationStyle } from "@telar/engine-client";

export type ComposerDecoration = {
  key: string;
  plugin: string;
  pattern: RegExp;
  style: PluginDecorationStyle;
  multiline?: boolean;
  preview?: { renderer: "katex" } | { verb: string };
};

export type ComposerCommand = { plugin: string; pluginName: string; name: string; description: string; verb: string; hint?: string };

export type ComposerExtensions = {
  decorations: readonly ComposerDecoration[];
  commands: readonly ComposerCommand[];
  call?: (plugin: string, verb: string, text: string) => Promise<string>;
};

export type DecorationRun = { start: number; end: number; decoration: ComposerDecoration };

const STYLES: readonly PluginDecorationStyle[] = ["math", "code", "accent", "muted"];
const SHIFT = 12;
const WORD = /[\p{L}\p{N}_]/u;
const LONGEST_LINE = 4_000;
const LONGEST_DRAFT = 20_000;

export const decorationBits = (style: PluginDecorationStyle) => (STYLES.indexOf(style) + 1) << SHIFT;
export const decorationStyleOf = (bits: number): PluginDecorationStyle | undefined => STYLES[((bits >> SHIFT) & 7) - 1];

// Markdown keeps precedence: nothing matches inside code, links or chips (`blocked`), a match may not touch a word
// character on either side (so `snake_case` and `a$b$c` stay plain), and earlier decorations win an overlap.
export function decorationRuns(draft: string, decorations: readonly ComposerDecoration[], blocked: (at: number) => boolean): DecorationRun[] {
  if (decorations.length === 0) return [];
  const taken = new Uint8Array(draft.length);
  const runs: DecorationRun[] = [];
  const scan = (decoration: ComposerDecoration, text: string, offset: number) => {
    const pattern = new RegExp(decoration.pattern.source, "gu");
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      const from = offset + match.index;
      const to = from + match[0].length;
      if (WORD.test(draft[from - 1] ?? "") || WORD.test(draft[to] ?? "")) continue;
      let free = true;
      for (let at = from; at < to && free; at += 1) free = !taken[at] && !blocked(at);
      if (!free) continue;
      taken.fill(1, from, to);
      runs.push({ start: from, end: to, decoration });
    }
  };
  for (const decoration of decorations) {
    if (decoration.multiline) {
      if (draft.length <= LONGEST_DRAFT) scan(decoration, draft, 0);
      continue;
    }
    for (let start = 0; start <= draft.length; ) {
      const newline = draft.indexOf("\n", start);
      const end = newline === -1 ? draft.length : newline;
      if (end - start <= LONGEST_LINE) scan(decoration, draft.slice(start, end), start);
      if (newline === -1) break;
      start = newline + 1;
    }
  }
  return runs.sort((left, right) => left.start - right.start);
}

export function runAt(runs: readonly DecorationRun[], caret: number): DecorationRun | undefined {
  return runs.find((run) => caret >= run.start && caret <= run.end);
}
