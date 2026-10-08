import { isActiveTurn, isToolItem, itemLabel, itemText, type JournalTurn } from "@telar/client/journal";

export type TranscriptRow =
  | { key: string; kind: "prompt"; text: string }
  | { key: string; kind: "reply"; text: string }
  | { key: string; kind: "tool"; text: string; running: boolean }
  | { key: string; kind: "status"; text: string; tone: "working" | "failed" };

/** What the phone draws for each turn: the prompt, the agent's words and one line per tool call. */
export function transcriptRows(turns: readonly JournalTurn[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const turn of turns) {
    if (turn.prompt.trim()) rows.push({ key: `${turn.runId}/prompt`, kind: "prompt", text: turn.prompt });
    for (const item of turn.items) {
      if (item.detail.type === "assistant_message") {
        const text = itemText(item).trim();
        if (text) rows.push({ key: item.id, kind: "reply", text });
      } else if (isToolItem(item)) {
        rows.push({ key: item.id, kind: "tool", text: itemLabel(item), running: item.status === "inProgress" });
      }
    }
    if (turn.failure) rows.push({ key: `${turn.runId}/failed`, kind: "status", text: turn.failure, tone: "failed" });
    else if (isActiveTurn(turn.state)) rows.push({ key: `${turn.runId}/working`, kind: "status", text: turn.state === "queued" ? "Queued" : "Working…", tone: "working" });
  }
  return rows;
}
