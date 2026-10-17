import { segmentDraft, type TelarReference } from "@telar/client/composer";

/** A reference drawn as one label: `start`/`end` in the shown text, `draftStart`/`draftEnd` in the draft it stands for. */
export type Pill = { start: number; end: number; draftStart: number; draftEnd: number; reference: TelarReference };

export type Shown = { text: string; pills: Pill[] };

const labelOf = (reference: TelarReference): string => (reference.kind === "skill" ? `$${reference.label}` : reference.label);

/** The field shows labels where the draft holds a reference's sentence; the draft is what is sent. Bare URLs stay typed text. */
export function showDraft(draft: string): Shown {
  let text = "";
  const pills: Pill[] = [];
  for (const segment of segmentDraft(draft)) {
    if (segment.type === "text" || (segment.reference.kind === "page" && segment.reference.text.startsWith("http"))) {
      text += segment.type === "text" ? segment.text : segment.reference.text;
      continue;
    }
    const label = labelOf(segment.reference);
    pills.push({ start: text.length, end: text.length + label.length, draftStart: segment.start, draftEnd: segment.end, reference: segment.reference });
    text += label;
  }
  return { text, pills };
}

export function toDraftOffset(pills: readonly Pill[], offset: number): number {
  let delta = 0;
  for (const pill of pills) {
    if (offset <= pill.start) break;
    if (offset >= pill.end) delta = pill.draftEnd - pill.end;
    else return pill.draftStart;
  }
  return offset + delta;
}

export function toShownOffset(pills: readonly Pill[], offset: number): number {
  let delta = 0;
  for (const pill of pills) {
    if (offset <= pill.draftStart) break;
    if (offset >= pill.draftEnd) delta = pill.end - pill.draftEnd;
    else return pill.start;
  }
  return offset + delta;
}

/** The caret never rests inside a pill: it moves to the nearer edge, the far one on a tie. */
export function snapOut(pills: readonly Pill[], offset: number): number {
  const pill = pills.find((candidate) => offset > candidate.start && offset < candidate.end);
  if (!pill) return offset;
  return offset - pill.start < pill.end - offset ? pill.start : pill.end;
}

/**
 * The draft after the field reports `next` where `shown` was drawn. An edit that
 * touches a pill takes the whole pill with it, so one Backspace removes it; typing
 * inside one lands after it.
 */
export function applyEdit(draft: string, shown: Shown, next: string): string {
  const { text: previous, pills } = shown;
  const limit = Math.min(previous.length, next.length);
  let head = 0;
  while (head < limit && previous[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < limit - head && previous[previous.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  let from = head;
  let to = previous.length - tail;
  const inserted = next.slice(head, next.length - tail);
  for (const pill of pills) {
    if (from === to && from > pill.start && from < pill.end) from = to = pill.end;
    else if (from < pill.end && to > pill.start) {
      from = Math.min(from, pill.start);
      to = Math.max(to, pill.end);
    }
  }
  return `${draft.slice(0, toDraftOffset(pills, from))}${inserted}${draft.slice(toDraftOffset(pills, to))}`;
}

/** The shown text cut into plain runs and pills, for drawing the pills in their own style. */
export function runsOf({ text, pills }: Shown): { text: string; pill: boolean }[] {
  const runs: { text: string; pill: boolean }[] = [];
  let at = 0;
  for (const pill of pills) {
    if (pill.start > at) runs.push({ text: text.slice(at, pill.start), pill: false });
    runs.push({ text: text.slice(pill.start, pill.end), pill: true });
    at = pill.end;
  }
  if (at < text.length || runs.length === 0) runs.push({ text: text.slice(at), pill: false });
  return runs;
}
