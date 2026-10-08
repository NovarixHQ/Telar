import { readEventStream } from "@/platform/engine/event-stream";
import type { RunStatusEvent } from "./types";

export type HubSignal = { type: "open" } | { type: "frame"; event: RunStatusEvent } | { type: "error"; message: string };
export type HubListener = (signal: HubSignal) => void;
export type Follow = (path: string, emit: HubListener, signal: AbortSignal) => Promise<void>;
export type RunStatusSource = { subscribe: (path: string, listener: HubListener) => () => void };

/** One upstream connection per path, however many listeners; the last one leaving closes it. */
export function createStatusHub(follow: Follow): RunStatusSource {
  const channels = new Map<string, { listeners: Set<HubListener>; open: boolean; controller: AbortController }>();
  return {
    subscribe(path, listener) {
      let channel = channels.get(path);
      if (!channel) {
        const created = { listeners: new Set<HubListener>(), open: false, controller: new AbortController() };
        channels.set(path, created);
        void follow(
          path,
          (signal) => {
            if (signal.type !== "frame") created.open = signal.type === "open";
            for (const each of created.listeners) each(signal);
          },
          created.controller.signal,
        );
        channel = created;
      }
      const joined = channel;
      joined.listeners.add(listener);
      // A late listener still needs its cue to read the state the feed does not replay.
      if (joined.open) listener({ type: "open" });
      return () => {
        if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
        joined.controller.abort();
        channels.delete(path);
      };
    },
  };
}

export type PortRequest = { type: "subscribe"; id: number; path: string } | { type: "unsubscribe"; id: number } | { type: "bye" };
export type PortReply = HubSignal & { id: number };

/** The worker side: one window's port, its subscriptions served from the shared hub. */
export function servePort(hub: RunStatusSource, port: MessagePort): void {
  const subscriptions = new Map<number, () => void>();
  const drop = (id: number) => {
    subscriptions.get(id)?.();
    subscriptions.delete(id);
  };
  port.onmessage = ({ data }: MessageEvent<PortRequest>) => {
    if (data.type === "bye") for (const id of [...subscriptions.keys()]) drop(id);
    else if (data.type === "unsubscribe") drop(data.id);
    else {
      drop(data.id);
      subscriptions.set(data.id, hub.subscribe(data.path, (signal) => port.postMessage({ ...signal, id: data.id } satisfies PortReply)));
    }
  };
}

type FollowOptions = {
  fetch?: (path: string, init: RequestInit) => Promise<Response>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Follows `/run/stream`, reconnecting with backoff; every (re)connect emits `open` because the feed has no replay. */
export function followRunStatus({ fetch: get = (path, init) => fetch(path, init), wait = sleep }: FollowOptions = {}): Follow {
  return async (path, emit, signal) => {
    let delay = 1_000;
    while (!signal.aborted) {
      try {
        const response = await get(path, { signal, headers: { accept: "text/event-stream" } });
        if (!response.ok || !response.body) throw new Error(`run stream ${response.status}`);
        delay = 1_000;
        emit({ type: "open" });
        await readEventStream(response.body, signal, (data) => {
          const event = data as RunStatusEvent;
          if (event?.type === "run.status") emit({ type: "frame", event });
        });
      } catch (cause) {
        if (signal.aborted) return;
        emit({ type: "error", message: cause instanceof Error ? cause.message : "The run feed is not answering." });
      }
      if (signal.aborted) return;
      await wait(delay, signal);
      delay = Math.min(delay * 2, 30_000);
    }
  };
}
