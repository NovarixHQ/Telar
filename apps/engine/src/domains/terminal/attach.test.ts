import { afterEach, expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { RunStreamFrame } from "@telar/engine-client";
import { errorFor } from "../../platform/http/http";
import { router } from "../../platform/http/router";
import type { EngineStore } from "../../state";
import type { OpenStream } from "../sessions";
import { attachTerminal } from "./attach";
import type { RunLaunchEvents, RunLauncher } from "./launcher";
import { RunManager } from "./manager";
import type { RunMount } from "./mount";
import { runRoutes } from "./run-routes";

const store = {
  records: { get: (id: string) => ({ id, projectId: "proj_1", workspace: { mode: "local", path: "/tmp/checkout" } }) },
} as unknown as EngineStore;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function terminal() {
  let events: RunLaunchEvents | undefined;
  const launcher: RunLauncher = {
    kind: "pty",
    async launch(_request, launched) {
      events = launched;
      return {
        pid: 424242,
        terminalId: "term_fake",
        close: async () => events?.exited({ exitCode: 0, closed: "close" }),
        signal: async () => {},
        write: async () => true,
        resize: async () => true,
      };
    },
  };
  const manager = new RunManager({ launcher });
  cleanups.push(() => manager.shutdown());
  const run = await manager.start({
    projectId: "proj_1",
    sessionId: "sess_1",
    config: { id: "runcfg_1", projectId: "proj_1", name: "dev", command: "dev", createdAt: 1, updatedAt: 1 },
    worktreePath: os.tmpdir(),
  });
  return { manager, terminalId: run.terminalId, print: (text: string) => events!.output("stdout", text), exit: () => events!.exited({ exitCode: 3 }) };
}

async function serve(manager: RunManager) {
  const openStreams = new Set<OpenStream>();
  const unsubscribed: string[] = [];
  const mount = {
    attach: (input, context) => {
      const subscribe = attachTerminal(manager, context().sessionId, input);
      return (send) => {
        const stop = subscribe(send);
        return () => {
          unsubscribed.push(String(input.terminalId));
          stop();
        };
      };
    },
  } as Pick<RunMount, "attach"> as RunMount;
  const server = http.createServer(router(runRoutes(store, mount, openStreams), { authorize: () => {}, errorFor: (error) => errorFor(error) }));
  const requests: http.IncomingMessage[] = [];
  server.on("request", (request: http.IncomingMessage) => requests.push(request));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  cleanups.push(() => server.closeAllConnections());
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, openStreams, unsubscribed, requests };
}

function frames(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    reader,
    async next(): Promise<RunStreamFrame> {
      for (;;) {
        const end = buffered.indexOf("\n\n");
        if (end !== -1) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          if (block.startsWith("data: ")) return RunStreamFrame.parse(JSON.parse(block.slice("data: ".length)));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("the stream ended");
        buffered += decoder.decode(value, { stream: true });
      }
    },
  };
}

test("an attach replays the ring after its cursor, then follows live bytes and the exit", async () => {
  const { manager, terminalId, print, exit } = await terminal();
  print("one\r\n");
  print("two\r\n");
  const { base } = await serve(manager);

  const response = await fetch(`${base}/v2/sessions/sess_1/run/bytes/stream?terminalId=${terminalId}&after=1`);
  expect([response.status, response.headers.get("content-type")]).toEqual([200, "text/event-stream"]);
  const stream = frames(response);
  cleanups.push(() => stream.reader.cancel());

  expect(await stream.next()).toMatchObject({ type: "run.status", sessionId: "sess_1", run: { terminalId, status: "running" } });
  expect(await stream.next()).toEqual({ type: "run.bytes", data: "two\r\n", cursor: 2, dropped: 0 });

  print("three\r\n");
  expect(await stream.next()).toEqual({ type: "run.bytes", data: "three\r\n", cursor: 3, dropped: 0 });

  exit();
  expect(await stream.next()).toMatchObject({ type: "run.status", run: { terminalId, status: "failed", exitCode: 3 } });
});

test("a viewer that hangs up is unsubscribed and its stream forgotten", async () => {
  const { manager, terminalId, print } = await terminal();
  const { base, openStreams, unsubscribed, requests } = await serve(manager);

  const hangUp = new AbortController();
  const response = await fetch(`${base}/v2/sessions/sess_1/run/bytes/stream?terminalId=${terminalId}`, { signal: hangUp.signal });
  const stream = frames(response);
  await stream.next();
  expect(await stream.next()).toMatchObject({ type: "run.bytes", cursor: 0 });
  expect(openStreams.size).toBe(1);

  const closed = new Promise((resolve) => requests[0]!.on("close", resolve));
  hangUp.abort();
  await closed;

  expect(unsubscribed).toEqual([terminalId]);
  expect(openStreams.size).toBe(0);
  expect(() => print("after\r\n")).not.toThrow();
});

test("a terminal this session does not have is refused before any stream opens", async () => {
  const { manager } = await terminal();
  const { base, openStreams } = await serve(manager);

  const missing = await fetch(`${base}/v2/sessions/sess_1/run/bytes/stream?terminalId=term_nope`);
  expect([missing.status, await missing.json()]).toEqual([404, { error: { code: "not_found", message: "this session has no terminal term_nope" } }]);
  const badCursor = await fetch(`${base}/v2/sessions/sess_1/run/bytes/stream?after=-1`);
  expect(badCursor.status).toBe(400);
  expect(openStreams.size).toBe(0);
});
