type FieldScroll = { offset: number; height: number; content: number };

function atEnd({ offset, height, content }: FieldScroll, slack: number): boolean {
  return offset + height >= content - slack;
}

/** Where to put the caret when dictated words land: at the end, unless the person scrolled away or rewrote the text. */
export function followCaret(previous: string, next: string, following: boolean): number | undefined {
  return following && next.length > previous.length && next.startsWith(previous) ? next.length : undefined;
}

type Following = { offset: number; following: boolean };

/** Appending text never scrolls the field up, so a move up short of the end is the person scrolling away. */
export function scrolled(last: Following, now: FieldScroll, slack: number): Following {
  return { offset: now.offset, following: atEnd(now, slack) || (last.following && now.offset >= last.offset) };
}
