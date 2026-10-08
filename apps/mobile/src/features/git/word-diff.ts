export type Span = { start: number; end: number };
type Token = { text: string; start: number; end: number };

const MAX_LINE = 600;
const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/;

function tokens(line: string): Token[] {
  const out: Token[] = [];
  let index = 0;
  while (index < line.length) {
    const first = line[index]!;
    let end = index + 1;
    const run = WORD.test(first) ? WORD : SPACE.test(first) ? SPACE : undefined;
    if (run) while (end < line.length && run.test(line[end]!)) end++;
    out.push({ text: line.slice(index, end), start: index, end });
    index = end;
  }
  return out;
}

function commonTokens(a: Token[], b: Token[]): { a: Set<number>; b: Set<number> } {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[i]!.text === b[j]!.text ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const keptA = new Set<number>();
  const keptB = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      keptA.add(i++);
      keptB.add(j++);
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return { a: keptA, b: keptB };
}

function changedSpans(list: Token[], kept: Set<number>): Span[] {
  const spans: Span[] = [];
  list.forEach((token, index) => {
    if (kept.has(index)) return;
    const last = spans.at(-1);
    if (last && last.end === token.start) last.end = token.end;
    else spans.push({ start: token.start, end: token.end });
  });
  return spans;
}

/** The changed spans of a removed and an added line, or nothing when the lines share too little to pair. */
export function wordChanges(before: string, after: string): { old: Span[]; new: Span[] } | undefined {
  if (before === after || before.length > MAX_LINE || after.length > MAX_LINE) return undefined;
  const a = tokens(before);
  const b = tokens(after);
  if (a.length === 0 || b.length === 0) return undefined;
  const common = commonTokens(a, b);
  let shared = 0;
  for (const index of common.a) shared += a[index]!.end - a[index]!.start;
  if (shared / Math.max(before.length, after.length) < 0.3) return undefined;
  return { old: changedSpans(a, common.a), new: changedSpans(b, common.b) };
}
