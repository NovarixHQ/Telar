import type { EngineClient, RunStreamFrame } from "@telar/engine-client";
import { fetch } from "expo/fetch";
import { viaCockpit } from "../../platform/connection";
import { takeFrames } from "./events";

/** Reads one event stream until the engine ends it; throws when it is refused or breaks. */
export async function readFrames({ url, headers }: ReturnType<EngineClient["locate"]>, onFrame: (frame: RunStreamFrame) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(viaCockpit(url), { headers: { ...headers, accept: "text/event-stream" }, signal });
  if (!response.ok || !response.body) throw new Error(`The computer refused the stream (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const taken = takeFrames(rest + decoder.decode(value, { stream: true }));
    rest = taken.rest;
    taken.frames.forEach(onFrame);
  }
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Runs `connect` again after it ends or fails, waiting `first`ms and doubling up to `max`; `heard` resets the wait. */
export async function keepFollowing(connect: (heard: () => void) => Promise<void>, signal: AbortSignal, { first, max }: { first: number; max: number }, onError?: (error: unknown) => void): Promise<void> {
  let wait = first;
  while (!signal.aborted) {
    try {
      await connect(() => (wait = first));
    } catch (error) {
      if (signal.aborted) return;
      onError?.(error);
      wait = Math.min(wait * 2, max);
    }
    await pause(wait, signal);
  }
}
