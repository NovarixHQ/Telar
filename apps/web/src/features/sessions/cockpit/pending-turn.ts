import type { JournalTurn } from "@telar/client/journal";

export type PendingTurn = { runId: string; prompt: string; acceptedAt: number; sessionId?: string };

/** The first message as a queued turn until the journal's own turn with that run id arrives. */
export function withPendingTurn(transcript: JournalTurn[], pending: PendingTurn | undefined): JournalTurn[] {
  if (!pending || transcript.some((turn) => turn.runId === pending.runId)) return transcript;
  const { runId, prompt, acceptedAt } = pending;
  return [...transcript, { runId, prompt, acceptedAt, origin: "user", state: "queued", items: [], tasks: [], resultText: "" }];
}

/** Dropped once its turn is in the journal, or when the cockpit moves to another session. */
export function pendingStillShown(pending: PendingTurn, sessionId: string | undefined, turns: readonly { runId: string }[]): boolean {
  if (pending.sessionId && sessionId !== pending.sessionId) return false;
  return !turns.some((turn) => turn.runId === pending.runId);
}
