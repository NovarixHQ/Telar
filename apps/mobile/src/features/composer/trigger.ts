type TriggerKind = "command" | "skill" | "mention";

export type Trigger = { kind: TriggerKind; query: string; start: number; end: number };

/** A `/` at the start of the caret's line, or an `@` or `$` word ending at the caret. */
export function detectTrigger(text: string, caret: number = text.length): Trigger | undefined {
  const end = Math.min(Math.max(0, caret), text.length);
  const head = text.slice(0, end);
  const lineStart = head.lastIndexOf("\n") + 1;
  const line = head.slice(lineStart);
  if (line.startsWith("/")) return { kind: "command", query: line.slice(1), start: lineStart, end };
  const start = Math.max(head.search(/\S*$/), lineStart);
  const token = head.slice(start);
  if (token.startsWith("@")) return { kind: "mention", query: token.slice(1), start, end };
  if (token.startsWith("$") && !token.startsWith("${")) return { kind: "skill", query: token.slice(1), start, end };
  return undefined;
}

export function replaceTrigger(text: string, trigger: Trigger, replacement: string): string {
  return `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
}

/** The draft with a `/` on a line of its own, so the command list opens. */
export function openingCommands(draft: string): string {
  return !draft || draft.endsWith("\n") ? `${draft}/` : `${draft}\n/`;
}
