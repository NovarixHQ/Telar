import type { HubSignal } from "@/features/terminal/run/status-hub";
import type { RunStatusEvent } from "@/features/terminal/run/types";

export function fakeUpstream() {
  const connections: Array<{ path: string; signal: AbortSignal; send: (event: RunStatusEvent) => void; end: () => void }> = [];
  const fetch = (path: string, init: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    const signal = init.signal!;
    signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    connections.push({
      path,
      signal,
      send: (event) => controller.enqueue(new TextEncoder().encode(`: beat\n\ndata: ${JSON.stringify(event)}\n\n`)),
      end: () => controller.close(),
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  return { connections, fetch };
}

export function recorder() {
  const seen: HubSignal[] = [];
  const waiters: Array<() => void> = [];
  return {
    seen,
    listener: (signal: HubSignal) => {
      seen.push(signal);
      waiters.splice(0).forEach((wake) => wake());
    },
    until: async (count: number) => {
      while (seen.length < count) await new Promise<void>((wake) => waiters.push(wake));
    },
  };
}

export const statusEvent = (status: string): RunStatusEvent => ({ type: "run.status", projectId: "p", sessionId: "s", run: { terminalId: "t", status } }) as unknown as RunStatusEvent;
