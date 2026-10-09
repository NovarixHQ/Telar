import type { JournalItem, JournalTurn } from "@telar/client/journal";

const touches = (item: JournalItem) => item.status === "completed" && (item.detail.type === "file_change" || item.detail.type === "command_execution");

/** Counts the finished edits and commands, the agent's and its sub-agents'; the diff is read again whenever this grows. */
export function diffRevision(turns: readonly JournalTurn[]): number {
  let total = 0;
  for (const turn of turns) {
    total += turn.items.filter(touches).length;
    for (const task of turn.tasks) total += task.items.filter(touches).length;
  }
  return total;
}
