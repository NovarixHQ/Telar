const MD = {
  mark: 1,
  strong: 2,
  em: 4,
  strike: 8,
  code: 16,
  link: 32,
  h1: 64,
  h2: 128,
  h3: 256,
  quote: 512,
  codeBlock: 1024,
  rule: 2048,
} as const;

export type MarkdownStyle = keyof typeof MD;

const OPAQUE = "￼";
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const QUOTE = /^ {0,3}(?:>[ \t]?)+/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]+/;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const WORD = /[\p{L}\p{N}]/u;

const isWord = (char: string | undefined) => char !== undefined && WORD.test(char);
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

function fill(bits: Uint16Array, from: number, to: number, bit: number): void {
  for (let at = from; at < to; at += 1) bits[at]! |= bit;
}

/** Backtick spans need a closing run of exactly the same length; their insides are never formatted. */
function codeSpans(chars: string[], from: number, to: number, bits: Uint16Array): void {
  let at = from;
  while (at < to) {
    if (chars[at] !== "`") {
      at += 1;
      continue;
    }
    let open = at;
    while (open < to && chars[open] === "`") open += 1;
    const size = open - at;
    let close = open;
    let found = -1;
    while (close < to && found < 0) {
      if (chars[close] !== "`") {
        close += 1;
        continue;
      }
      let end = close;
      while (end < to && chars[end] === "`") end += 1;
      if (end - close === size) found = close;
      close = end;
    }
    if (found < 0) {
      at = open;
      continue;
    }
    fill(bits, at, open, MD.mark);
    fill(bits, open, found, MD.code);
    fill(bits, found, found + size, MD.mark);
    for (let masked = at; masked < found + size; masked += 1) chars[masked] = OPAQUE;
    at = found + size;
  }
}

function links(chars: string[], from: number, to: number, bits: Uint16Array): void {
  const line = chars.slice(from, to).join("");
  LINK.lastIndex = 0;
  for (let match = LINK.exec(line); match; match = LINK.exec(line)) {
    const open = from + match.index;
    const textEnd = open + 1 + match[1]!.length;
    const end = open + match[0].length;
    fill(bits, open, open + 1, MD.mark);
    fill(bits, open + 1, textEnd, MD.link);
    fill(bits, textEnd, end, MD.mark);
    chars[open] = OPAQUE;
    for (let masked = textEnd; masked < end; masked += 1) chars[masked] = OPAQUE;
  }
}

/** A closing run for `size` delimiters: whole run not after a space and not before a word character. */
function closer(chars: string[], char: string, size: number, from: number, to: number): number {
  let at = from;
  while (at < to) {
    if (chars[at] !== char) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < to && chars[end] === char) end += 1;
    const start = end - size;
    if (end - at >= size && start > from && !isSpace(chars[at - 1]) && !isWord(chars[end])) return start;
    at = end;
  }
  return -1;
}

/** Delimiters inside words never open or close, so snake_case, file_names.ts and 2*3*4 stay plain. */
function emphasis(chars: string[], from: number, to: number, bits: Uint16Array): void {
  let at = from;
  while (at < to) {
    const char = chars[at]!;
    if (char !== "*" && char !== "_" && char !== "~") {
      at += 1;
      continue;
    }
    let runEnd = at;
    while (runEnd < to && chars[runEnd] === char) runEnd += 1;
    const run = runEnd - at;
    const sizes = char === "~" ? (run === 2 ? [2] : []) : run >= 2 ? [2, 1] : [1];
    let next = runEnd;
    for (const size of sizes) {
      if (isWord(chars[at - 1]) || isSpace(chars[runEnd])) continue;
      const close = closer(chars, char, size, at + size, to);
      if (close < 0) continue;
      const bit = char === "~" ? MD.strike : size === 2 ? MD.strong : MD.em;
      fill(bits, at, at + size, MD.mark);
      fill(bits, at + size, close, bit);
      fill(bits, close, close + size, MD.mark);
      emphasis(chars, at + size, close, bits);
      next = close + size;
      break;
    }
    at = next;
  }
}

function inline(chars: string[], from: number, to: number, bits: Uint16Array): void {
  codeSpans(chars, from, to, bits);
  links(chars, from, to, bits);
  emphasis(chars, from, to, bits);
}

/**
 * One bit set of `MD` per character of the draft. Ranges in `opaque` (chips) are
 * never read as Markdown and get no bits. Linear in the draft's length.
 */
export function markdownStyles(draft: string, opaque: readonly { start: number; end: number }[] = []): Uint16Array {
  const bits = new Uint16Array(draft.length);
  const chars = draft.split("");
  for (const { start, end } of opaque) {
    for (let at = start; at < end; at += 1) if (chars[at] !== "\n") chars[at] = OPAQUE;
  }
  const text = chars.join("");
  let fence: { char: string; size: number } | undefined;
  for (let start = 0; start <= text.length; ) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end);
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      const closes = fenceMatch && fenceMatch[1]![0] === fence.char && fenceMatch[1]!.length >= fence.size && !line.slice(fenceMatch[0].length).trim();
      fill(bits, start, end, MD.codeBlock | (closes ? MD.mark : 0));
      if (closes) fence = undefined;
    } else if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, size: fenceMatch[1]!.length };
      fill(bits, start, end, MD.codeBlock | MD.mark);
    } else if (RULE.test(line)) {
      fill(bits, start, end, MD.rule | MD.mark);
    } else {
      const heading = HEADING.exec(line);
      const quote = heading ? null : QUOTE.exec(line);
      const list = heading || quote ? null : LIST.exec(line);
      const marker = (heading ?? quote ?? list)?.[0].length ?? 0;
      const block = heading ? [MD.h1, MD.h2, MD.h3][Math.min(heading[1]!.length, 3) - 1]! : quote ? MD.quote : 0;
      fill(bits, start, start + marker, MD.mark | (heading ? block : 0));
      fill(bits, start + marker, end, block);
      inline(chars, start + marker, end, bits);
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  for (const { start, end } of opaque) bits.fill(0, start, end);
  return bits;
}

/** The style names a bit set stands for, in `MD` order. */
export function styleNames(bits: number): MarkdownStyle[] {
  return (Object.keys(MD) as MarkdownStyle[]).filter((name) => bits & MD[name]);
}
