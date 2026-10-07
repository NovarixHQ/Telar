import { expect, test } from "bun:test";
import { fakeUpstream, recorder, statusEvent } from "@/test/run-status-upstream";
import { createStatusHub, followRunStatus } from "./status-hub";

test("two listeners on one session share one connection and both get every frame", async () => {
  const upstream = fakeUpstream();
  const hub = createStatusHub(followRunStatus({ fetch: upstream.fetch }));
  const header = recorder();
  const strip = recorder();
  hub.subscribe("/api/sessions/s/run/stream", header.listener);
  hub.subscribe("/api/sessions/s/run/stream", strip.listener);
  await header.until(1);
  await strip.until(1);

  upstream.connections[0]!.send(statusEvent("ready"));
  await header.until(2);
  await strip.until(2);

  expect(upstream.connections).toHaveLength(1);
  expect(header.seen.map((signal) => signal.type)).toEqual(["open", "frame"]);
  expect(strip.seen.at(-1)).toEqual({ type: "frame", event: statusEvent("ready") });
});

test("a listener joining an open feed is told to read state, and the last one leaving closes it", async () => {
  const upstream = fakeUpstream();
  const hub = createStatusHub(followRunStatus({ fetch: upstream.fetch }));
  const first = recorder();
  const stopFirst = hub.subscribe("/stream", first.listener);
  await first.until(1);

  const late = recorder();
  const stopLate = hub.subscribe("/stream", late.listener);
  expect(late.seen).toEqual([{ type: "open" }]);

  stopFirst();
  expect(upstream.connections[0]!.signal.aborted).toBe(false);
  stopLate();
  expect(upstream.connections[0]!.signal.aborted).toBe(true);
});

test("a dropped feed reconnects after the backoff and cues another state read", async () => {
  const upstream = fakeUpstream();
  const waits: number[] = [];
  const hub = createStatusHub(followRunStatus({ fetch: upstream.fetch, wait: async (ms) => void waits.push(ms) }));
  const listener = recorder();
  hub.subscribe("/stream", listener.listener);
  await listener.until(1);

  upstream.connections[0]!.end();
  await listener.until(2);

  expect(waits).toEqual([1_000]);
  expect(upstream.connections).toHaveLength(2);
  expect(listener.seen.map((signal) => signal.type)).toEqual(["open", "open"]);
});
