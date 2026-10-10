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

const RENDERERS: { [T in "notebook.cell.output" | "plugin.event" | "ds.watch.violated"]: Renderer<T> } = {
  "notebook.cell.output": (event) => {
    const output = event.output as { kind?: string; attachmentId?: string } | null;
    if (output?.kind !== "image" || !output.attachmentId) return undefined;
    return {
      ...row(event, `plot_${output.attachmentId}`),
      status: "completed",
      detail: { type: "unknown", label: `Drew a figure${event.producer ? ` — ${event.producer}` : ""}` },
      plotAttachmentId: output.attachmentId,
    };
  },
  "plugin.event": ({ note, ...event }) => {
    if (!note) return undefined;
    return {
      ...row(event as EngineEvent, `${event.pluginId}_${event.id}`),
      status: note.failed ? "failed" : "completed",
      detail: note.failed ? { type: "error", error: { message: note.text } } : { type: "unknown", label: note.text },
      ...(note.attachmentId ? { plotAttachmentId: note.attachmentId } : {}),
    };
  },
  "ds.watch.violated": (event) => ({
    ...row(event, `watch_${event.id}`),
    status: "failed",
    detail: { type: "error", error: { message: `Watch "${event.watch}" violated: ${event.assert}${event.detail ? ` (${event.detail})` : ""}` } },
  }),
};

export function pluginJournalRow(event: EngineEvent): JournalItem | undefined {
  const render = (RENDERERS as Record<string, Renderer<EngineEvent["type"]> | undefined>)[event.type];
  return render?.(event as never);
}
