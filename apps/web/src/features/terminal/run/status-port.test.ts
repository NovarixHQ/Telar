import { afterEach, expect, test } from "bun:test";
import { fakeUpstream, recorder, statusEvent } from "@/test/run-status-upstream";
import { createStatusHub, followRunStatus, servePort } from "./status-hub";
import { portSource, runStatusSource } from "./status-port";

const ports: MessagePort[] = [];
afterEach(() => ports.splice(0).forEach((port) => port.close()));

function connectWindow(hub: ReturnType<typeof createStatusHub>) {
  const channel = new MessageChannel();
  ports.push(channel.port1, channel.port2);
  servePort(hub, channel.port2);
  return portSource(channel.port1);
}

test("two windows on one session hold one connection, and both get the frame", async () => {
  const upstream = fakeUpstream();
  const worker = createStatusHub(followRunStatus({ fetch: upstream.fetch }));
  const left = recorder();
  const right = recorder();
  connectWindow(worker).subscribe("/api/sessions/s/run/stream", left.listener);
  connectWindow(worker).subscribe("/api/sessions/s/run/stream", right.listener);
  await left.until(1);
  await right.until(1);

  upstream.connections[0]!.send(statusEvent("ready"));
  await left.until(2);
  await right.until(2);

  expect(upstream.connections).toHaveLength(1);
  expect(left.seen).toEqual([{ type: "open" }, { type: "frame", event: statusEvent("ready") }]);
  expect(right.seen).toEqual(left.seen);
});

test("a window that goes away releases its subscriptions, and the last one closes the connection", async () => {
  const upstream = fakeUpstream();
  const worker = createStatusHub(followRunStatus({ fetch: upstream.fetch }));
  const closing = connectWindow(worker);
  const staying = recorder();
  const listener = recorder();
  closing.subscribe("/stream", listener.listener);
  const stop = connectWindow(worker).subscribe("/stream", staying.listener);
  await listener.until(1);
  await staying.until(1);

  closing.detach();
  stop();
  await new Promise<void>((resolve) => upstream.connections[0]!.signal.addEventListener("abort", () => resolve(), { once: true }));
  expect(upstream.connections[0]!.signal.aborted).toBe(true);
});

test("without SharedWorker the window follows the feed itself", async () => {
  expect(typeof SharedWorker).toBe("undefined");
  const upstream = fakeUpstream();
  const original = globalThis.fetch;
  globalThis.fetch = ((path: string, init: RequestInit) => upstream.fetch(path, init)) as typeof fetch;
  try {
    const feed = recorder();
    const stop = runStatusSource().subscribe("/api/sessions/s/run/stream", feed.listener);
    await feed.until(1);
    upstream.connections[0]!.send(statusEvent("exited"));
    await feed.until(2);
    stop();
    expect(feed.seen).toEqual([{ type: "open" }, { type: "frame", event: statusEvent("exited") }]);
    expect(upstream.connections[0]!.path).toBe("/api/sessions/s/run/stream");
  } finally {
    globalThis.fetch = original;
  }
});
