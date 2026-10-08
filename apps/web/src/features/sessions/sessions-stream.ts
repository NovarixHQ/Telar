"use client";

import { useEffect, useRef } from "react";
import { readEventStream } from "@/platform/engine/event-stream";
import { hostFetcher } from "@/platform/engine/host-client";

export type SessionFrame = { sessionId: string; id: number; type: string };
type Listener = { frame: (frame: SessionFrame) => void; open: () => void };
type Channel = { listeners: Set<Listener>; open: boolean; controller: AbortController };

const RETRY_MAX_MS = 60_000;
const channels = new Map<string, Channel>();

const isFrame = (data: unknown): data is SessionFrame =>
  typeof data === "object" && data !== null && typeof (data as SessionFrame).sessionId === "string" && typeof (data as SessionFrame).type === "string";

export const changesRow = (frame: SessionFrame): boolean => /^(turn|session|request)\./.test(frame.type);

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

async function follow(hostId: string, channel: Channel) {
  const { signal } = channel.controller;
  let delay = 1_000;
  while (!signal.aborted) {
    try {
      const response = await hostFetcher(hostId)("/api/sessions/stream", { signal, headers: { accept: "text/event-stream" } });
      const body = response.ok && response.headers.get("content-type")?.includes("text/event-stream") ? response.body : null;
      if (!body && (response.ok || response.status === 404)) return;
      if (!body) throw new Error(`sessions stream ${response.status}`);
      delay = 1_000;
      channel.open = true;
      for (const listener of channel.listeners) listener.open();
      await readEventStream(body, signal, (data) => {
        if (isFrame(data)) for (const listener of channel.listeners) listener.frame(data);
      });
    } catch {
      if (signal.aborted) return;
    }
    channel.open = false;
    await wait(delay, signal);
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  }
}

function subscribe(hostId: string, listener: Listener): () => void {
  let channel = channels.get(hostId);
  if (!channel) {
    channel = { listeners: new Set(), open: false, controller: new AbortController() };
    channels.set(hostId, channel);
    void follow(hostId, channel);
  }
  const joined = channel;
  joined.listeners.add(listener);
  if (joined.open) listener.open();
  return () => {
    if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
    joined.controller.abort();
    channels.delete(hostId);
  };
}

/** Every session event on `hostId`, one connection per host; it has no replay, so `onOpen` runs on each (re)connect. An engine answering 404 is not asked again. */
export function useSessionsStream(hostId: string | undefined, onFrame: (frame: SessionFrame) => void, onOpen: () => void): void {
  const latest = useRef({ onFrame, onOpen });
  useEffect(() => {
    latest.current = { onFrame, onOpen };
  });
  useEffect(() => {
    if (!hostId) return;
    return subscribe(hostId, { frame: (frame) => latest.current.onFrame(frame), open: () => latest.current.onOpen() });
  }, [hostId]);
}
