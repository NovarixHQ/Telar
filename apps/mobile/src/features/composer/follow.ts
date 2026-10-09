type FieldScroll = { offset: number; height: number; content: number };

function atEnd({ offset, height, content }: FieldScroll, slack: number): boolean {
  return offset + height >= content - slack;
}

/** Whether to move the field's caret to where dictated words landed: not when the person rewrote the text, or scrolled away from the end the words went to. */
export function followCaret(previous: string, next: string, caret: number, following: boolean): number | undefined {
  const at = caret - (next.length - previous.length);
  const inserted = at >= 0 && at < caret && next.slice(0, at) === previous.slice(0, at) && next.slice(caret) === previous.slice(at);
  return inserted && (following || caret < next.length) ? caret : undefined;
}

type Following = { offset: number; following: boolean };

/** Appending text never scrolls the field up, so a move up short of the end is the person scrolling away. */
export function scrolled(last: Following, now: FieldScroll, slack: number): Following {
  return { offset: now.offset, following: atEnd(now, slack) || (last.following && now.offset >= last.offset) };
}
