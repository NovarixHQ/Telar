import type http from "node:http";
import type { EngineEvent, PluginEventFrame } from "@telar/engine-client";
import type { Route } from "../../platform/http/route";
import type { EngineStore } from "../../state";

/** A stream the engine must be able to end on shutdown; `end` also closes the response. */
export type OpenStream = (() => void) & { end?: () => void };

const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Holds an SSE response open: headers flushed with `: open` (writeHead alone doesn't send them),
 * a 25 s `: beat` so proxies keep it, and registration in `openStreams` so `close()` can end it.
 */
export function holdEventStream(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  openStreams: Set<OpenStream>,
  subscribe: (send: (data: unknown) => void) => () => void,
): void {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  response.write(": open\n\n");
  let stop = (): void => {};
  const write = (chunk: string): void => {
    if (!openStreams.has(finish)) return;
    try {
      response.write(chunk);
    } catch {
      /* the socket has gone; the close handler unsubscribes */
    }
    if (response.writableLength > MAX_BUFFERED_BYTES) finish.end?.();
  };
  const beat = setInterval(() => write(": beat\n\n"), 25_000);
  beat.unref();
  const finish: OpenStream = () => {
    clearInterval(beat);
    stop();
    openStreams.delete(finish);
  };
  openStreams.add(finish);
  request.on("close", finish);
  response.on("close", finish);
  finish.end = () => {
    finish();
    try {
      response.end();
    } catch {
      /* already gone */
    }
  };
  stop = subscribe((data) => write(`data: ${JSON.stringify(data)}\n\n`));
  if (!openStreams.has(finish)) stop();
}

type WatchPluginFrames = (listener: (frame: PluginEventFrame) => void) => () => void;

const frameOf = (event: EngineEvent) => {
  if (event.type !== "plugin.event") return { sessionId: event.sessionId, id: event.id, type: event.type };
  const { runId: _run, providerRefs: _refs, raw: _raw, ...frame } = event;
  return frame;
};

/**
 * Every session's events on one connection, live only: event ids are per session, so there is no
 * global cursor to replay from. A frame names a fact a reader re-derives from `/events`, except a plugin event, which travels whole.
 */
export function sessionsStreamRoute(store: EngineStore, openStreams: Set<OpenStream>, watchPluginFrames?: WatchPluginFrames): Route {
  return {
    method: "GET",
    path: "/v2/sessions/stream",
    auth: "engine",
    handle({ request, response }) {
      holdEventStream(request, response, openStreams, (send) => {
        const stops = [store.kernel.watch((event) => send(frameOf(event))), watchPluginFrames?.(send)];
        return () => stops.forEach((stop) => stop?.());
      });
      return undefined;
    },
  };
}
