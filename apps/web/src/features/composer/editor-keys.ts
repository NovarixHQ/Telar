export const PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES = 32 * 1024;

const INDENT = "  ";
const LIST_ITEM = /^(\s*)([-*]|\d+[.)])(\s+\[[ xX]\])?(\s+)/;

type Edit = { text: string; cursor: number };

export function isLargePaste(text: string): boolean {
  return text.length >= PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES || new TextEncoder().encode(text).byteLength >= PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES;
}

/** A large paste as a text file, named so several in one draft stay apart. */
export function pastedTextFile(text: string, existingNames: readonly string[]): File {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()));
  let name = "pasted-text.txt";
  for (let sequence = 2; taken.has(name); sequence += 1) name = `pasted-text-${sequence}.txt`;
  return new File([text], name, { type: "text/plain;charset=utf-8" });
}

function lineAt(text: string, caret: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const newline = text.indexOf("\n", caret);
  const end = newline === -1 ? text.length : newline;
  return { start, end, line: text.slice(start, end) };
}

function insideFence(text: string, lineStart: number): boolean {
  const fences = text.slice(0, lineStart).split("\n").filter((line) => /^\s*```/.test(line));
  return fences.length % 2 === 1;
}

function nextMarker(marker: string): string {
  const ordered = /^(\d+)([.)])$/.exec(marker);
  return ordered ? `${Number(ordered[1]) + 1}${ordered[2]}` : marker;
}

/** The new line a Shift+Enter makes: the next list marker, an ended list, or a code line at the same indent. */
export function continueLine(text: string, caret: number): Edit | undefined {
  const { start, line } = lineAt(text, caret);
  const before = line.slice(0, caret - start);
  if (insideFence(text, start)) {
    const indent = /^[ \t]*/.exec(before)![0];
    if (!indent) return undefined;
    return { text: text.slice(0, caret) + "\n" + indent + text.slice(caret), cursor: caret + 1 + indent.length };
  }
  const item = LIST_ITEM.exec(line);
  if (!item || caret - start < item[0].length) return undefined;
  if (line.slice(item[0].length).trim() === "") {
    return { text: text.slice(0, start) + text.slice(start + line.length), cursor: start };
  }
  const [, indent, marker, task, gap] = item;
  const prefix = `${indent}${nextMarker(marker!)}${task ? " [ ]" : ""}${gap}`;
  return { text: text.slice(0, caret) + "\n" + prefix + text.slice(caret), cursor: caret + 1 + prefix.length };
}

/** Tab and Shift+Tab on a list item move it one level; anywhere else they keep their usual meaning. */
export function indentLine(text: string, caret: number, outdent: boolean): Edit | undefined {
  const { start, line } = lineAt(text, caret);
  if (!LIST_ITEM.test(line)) return undefined;
  if (!outdent) return { text: text.slice(0, start) + INDENT + text.slice(start), cursor: caret + INDENT.length };
  const removed = /^ {1,2}|^\t/.exec(line)?.[0].length ?? 0;
  if (removed === 0) return { text, cursor: caret };
  return { text: text.slice(0, start) + text.slice(start + removed), cursor: Math.max(start, caret - removed) };
}
