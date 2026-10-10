import type { EngineEvent } from "@telar/engine-client";
import type { JournalItem } from "./journal";

type Renderer<T extends EngineEvent["type"]> = (event: Extract<EngineEvent, { type: T }>) => JournalItem | undefined;

const row = (event: EngineEvent, id: string) => ({
  id,
  runId: event.runId!,
  sessionId: event.sessionId,
  startedAt: event.at,
  completedAt: event.at,
  streamedText: "",
  openedBy: event.id,
});

const RENDERERS: { [T in "plugin.event"]: Renderer<T> } = {
  "plugin.event": ({ note, ...event }) => {
    if (!note) return undefined;
    return {
      ...row(event as EngineEvent, `${event.pluginId}_${event.id}`),
      status: note.failed ? "failed" : "completed",
      detail: note.failed ? { type: "error", error: { message: note.text } } : { type: "unknown", label: note.text },
      ...(note.attachmentId ? { plotAttachmentId: note.attachmentId } : {}),
    };
  },
};

export function pluginJournalRow(event: EngineEvent): JournalItem | undefined {
  const render = (RENDERERS as Record<string, Renderer<EngineEvent["type"]> | undefined>)[event.type];
  return render?.(event as never);
}
