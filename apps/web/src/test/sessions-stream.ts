import type { PluginEventFrame } from "@telar/engine-client";
import type { SessionFrame } from "@/platform/engine/sessions-stream";

export function fakeSessionsStream() {
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let connections = 0;
  return {
    get connections() {
      return connections;
    },
    answer(signal?: AbortSignal | null): Response {
      connections += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          open.add(controller);
          signal?.addEventListener("abort", () => {
            open.delete(controller);
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
    announce(frame: SessionFrame | PluginEventFrame) {
      const bytes = new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
      for (const controller of open) controller.enqueue(bytes);
    },
  };
}
