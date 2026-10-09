import type { Grant } from "./grant";
import type { Words } from "./strip";

const LISTEN_URL = "wss://api.deepgram.com/v1/listen";
const CLOSE_STREAM = JSON.stringify({ type: "CloseStream" });
const DRAIN_MS = 2_000;

/** The same live query the Swift app opens: interim results on, raw 16-bit mono PCM. */
export function listenUrl(language: string, keyterms: readonly string[], sampleRate: number): string {
  const url = new URL(LISTEN_URL);
  const query: Record<string, string> = {
    model: "nova-3",
    interim_results: "true",
    smart_format: "true",
    numerals: "true",
    language,
    endpointing: "300",
    encoding: "linear16",
    sample_rate: String(Math.round(sampleRate)),
    channels: "1",
  };
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  for (const term of keyterms) url.searchParams.append("keyterm", term);
  return url.toString();
}

type Frame = { type?: string; is_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } };

export function readWords(text: string): Words | undefined {
  let frame: Frame;
  try {
    frame = JSON.parse(text) as Frame;
  } catch {
    return undefined;
  }
  if ((frame.type && frame.type !== "Results") || !frame.channel?.alternatives) return undefined;
  return { text: (frame.channel.alternatives[0]?.transcript ?? "").trim(), final: frame.is_final === true };
}

type Socket = {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
};

export type Live = { send(chunk: ArrayBuffer): void; finish(): Promise<void>; cancel(): void };

const OPEN = 1;

/** One listen socket. Audio sent before it opens is held, and `ended` fires only if it closes before `finish` or `cancel`. */
export function openLive(
  grant: Grant,
  sampleRate: number,
  on: { words: (words: Words) => void; ended: () => void },
  // The grant JWT rides in the subprotocol, with `bearer` as the scheme word.
  connect: (url: string, protocols: string[]) => Socket = (url, protocols) => new WebSocket(url, protocols) as unknown as Socket,
): Live {
  const socket = connect(listenUrl(grant.language, grant.keyterms, sampleRate), ["bearer", grant.token]);
  const held: ArrayBuffer[] = [];
  let closing = false;
  let drained: (() => void) | undefined;
  const closed = () => {
    if (closing) return drained?.();
    closing = true;
    on.ended();
  };
  socket.onopen = () => {
    for (const chunk of held.splice(0)) socket.send(chunk);
  };
  socket.onmessage = ({ data }) => {
    const words = typeof data === "string" ? readWords(data) : undefined;
    if (words) on.words(words);
  };
  socket.onerror = closed;
  socket.onclose = closed;
  const close = () => {
    closing = true;
    if (socket.readyState === OPEN) socket.send(CLOSE_STREAM);
    socket.close();
  };
  return {
    send(chunk) {
      if (closing) return;
      if (socket.readyState === OPEN) socket.send(chunk);
      else held.push(chunk);
    },
    async finish() {
      if (closing) return;
      if (socket.readyState !== OPEN) return close();
      closing = true;
      socket.send(CLOSE_STREAM);
      await new Promise<void>((resolve) => {
        drained = resolve;
        setTimeout(resolve, DRAIN_MS);
      });
      socket.close();
    },
    cancel: close,
  };
}
