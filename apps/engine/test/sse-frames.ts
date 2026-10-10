import type { EngineDaemon } from "../src/daemon";

export function openSessionsStream(daemon: EngineDaemon): Promise<Response> {
  return fetch(`http://127.0.0.1:${daemon.discovery.port}/v2/sessions/stream`, { headers: { authorization: `Bearer ${daemon.discovery.token}` } });
}

export async function readFrames(
  body: ReadableStream<Uint8Array>,
  wanted: number,
  keep: (frame: Record<string, unknown>) => boolean = () => true,
  budgetMs = 4_000,
): Promise<Record<string, unknown>[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const seen: Record<string, unknown>[] = [];
  const deadline = Date.now() + budgetMs;
  const timeout = setTimeout(() => void reader.cancel().catch(() => {}), budgetMs);
  let buffered = "";
  try {
    while (seen.length < wanted && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const frame = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (keep(frame)) seen.push(frame);
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
  return seen;
}
