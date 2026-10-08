export type Slot = { kind: "send" | "stop"; enabled: boolean; label: string };

type State = { draft: string; running: boolean; busy: boolean; hasImage?: boolean; queued?: number };

/** The round button beside the field: Stop while a turn runs and nothing is ready to send, otherwise Send, or Queue behind other work. */
export function composerSlot({ draft, running, busy, hasImage = false, queued = 0 }: State): Slot {
  const canSend = draft.trim().length > 0 || hasImage;
  if (running && !canSend) return { kind: "stop", enabled: !busy, label: "Stop the running turn" };
  return { kind: "send", enabled: canSend && !busy, label: running || queued > 0 ? "Queue" : "Send" };
}
