export type Words = { text: string; final: boolean };

/** The words heard but not yet final; `spent` counts the leading words already written into the draft. */
export type Strip = { heard: string; spent: number };

export const EMPTY_STRIP: Strip = { heard: "", spent: 0 };

type Step = { strip: Strip; commit: string };

/** A final result is written into the draft; an interim one replaces what the strip shows. */
export function hear(strip: Strip, words: Words): Step {
  const said = dropWords(strip.spent, words.text);
  return words.final ? { strip: EMPTY_STRIP, commit: said } : { strip: { ...strip, heard: said }, commit: "" };
}

/** Writes the interim words into the draft now; later results of the same phrase skip them. */
export function flush(strip: Strip): Step {
  if (!strip.heard) return { strip, commit: "" };
  return { strip: { heard: "", spent: strip.spent + wordsIn(strip.heard).length }, commit: strip.heard };
}

/** Appends spoken words to the draft with one space between them. */
export function appendSpoken(draft: string, words: string): string {
  if (!words) return draft;
  return draft && !/\s$/.test(draft) ? `${draft} ${words}` : `${draft}${words}`;
}

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean);

const dropWords = (count: number, text: string) => (count > 0 ? wordsIn(text).slice(count).join(" ") : text.trim());
