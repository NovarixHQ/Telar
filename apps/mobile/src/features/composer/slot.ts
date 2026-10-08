export type Slot = { kind: "send" | "stop"; enabled: boolean; label: string };

/** The round button beside the field: Stop while a turn runs and the box is empty, otherwise Send (Queue behind a running turn). */
export function composerSlot(draft: string, running: boolean, busy: boolean): Slot {
  const canSend = draft.trim().length > 0;
  if (running && !canSend) return { kind: "stop", enabled: !busy, label: "Stop the running turn" };
  return { kind: "send", enabled: canSend && !busy, label: running ? "Queue" : "Send" };
}
