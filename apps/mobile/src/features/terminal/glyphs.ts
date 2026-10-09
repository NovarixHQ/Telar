export type GlyphRun = { text: string; symbols: boolean };

/** Nerd Font icons live in the private-use planes, which no system font draws. */
const isPrivateUse = (code: number) => (code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000;

/** The text cut where it moves in or out of private use, so only those runs take the symbols face. */
export function glyphRuns(text: string): GlyphRun[] {
  const runs: GlyphRun[] = [];
  for (const char of text) {
    const symbols = isPrivateUse(char.codePointAt(0)!);
    const last = runs.at(-1);
    if (last?.symbols === symbols) last.text += char;
    else runs.push({ text: char, symbols });
  }
  return runs;
}
