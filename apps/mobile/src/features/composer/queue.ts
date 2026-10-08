import type { JournalTurn } from "@telar/client/journal";

/** Messages behind the running turn, including one being steered into it. */
export function queuedTurns(turns: readonly JournalTurn[]): JournalTurn[] {
  return turns.filter((turn) => turn.state === "queued" || turn.state === "steering");
}

/** A turn the agent is on: what Stop ends, and what a queued message can be sent into. */
export function hasRunningTurn(turns: readonly JournalTurn[]): boolean {
  return turns.some((turn) => turn.state === "running" || turn.state === "claimed" || turn.state === "steering");
}

export function queueSummary(queued: readonly JournalTurn[]): string {
  if (queued.some((turn) => turn.state === "steering")) return "Sending into the running turn…";
  const waiting = queued.filter((turn) => turn.state === "queued").length;
  return `${waiting} queued message${waiting === 1 ? "" : "s"} will send automatically.`;
}
