import { afterEach, expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeHost } from "../../../test/pty-fakes";
import { errorFor } from "../../platform/http/http";
import { router } from "../../platform/http/router";
import type { OpenStream } from "../sessions";
import { shellRoutes } from "./shell-routes";
import { ShellHub } from "./shells";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(hub: ShellHub | undefined) {
  const openStreams = new Set<OpenStream>();
  const server = http.createServer(router(shellRoutes(hub, openStreams), { authorize: () => {}, errorFor: (error) => errorFor(error) }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  cleanups.push(() => server.closeAllConnections());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (tail: string, body: unknown = {}) =>
    fetch(`${base}/v2/terminals${tail}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { post, openStreams };
}

function sse(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  cleanups.push(() => reader.cancel());
  return async (): Promise<unknown> => {
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end !== -1) {
        const block = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (block.startsWith("data: ")) return JSON.parse(block.slice(6));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("the stream ended");
      buffered += decoder.decode(value, { stream: true });
    }
  };
}

test("a shell is opened, typed into, resized, streamed and closed over HTTP", async () => {
  const { host, ptys } = fakeHost();
  const { post } = await serve(new ShellHub(host));

  const opened = (await (await post("/open", { sessionId: "s1", cols: 100, rows: 30 })).json()) as { id: string; pid: number };
  expect(opened.pid).toBe(40_000);
  expect(((await (await post("/list", { sessionId: "s1" })).json()) as { terminals: unknown[] }).terminals).toHaveLength(1);

  ptys[0]!.emitData("hello\r\n");
  const next = sse(await post(`/${opened.id}/stream`, { after: 0 }));
  expect(await next()).toEqual({ type: "data", data: "hello\r\n", cursor: 1 });

  expect(await (await post(`/${opened.id}/write`, { data: "ls\r" })).json()).toEqual({ ok: true });
  expect(await (await post(`/${opened.id}/resize`, { cols: 120, rows: 40 })).json()).toEqual({ ok: true });
  expect(ptys[0]!.writes).toEqual(["ls\r"]);
  expect(ptys[0]!.resizes).toEqual([[120, 40]]);

  expect(await (await post(`/${opened.id}/close`)).json()).toEqual({ ok: true });
  expect(await next()).toMatchObject({ type: "exit", ending: { fate: "exited", closed: "close" } });
});

test("activity answers for the named terminals, or for everything the host holds", async () => {
  const { host } = fakeHost();
  const hub = new ShellHub(host);
  const { post } = await serve(hub);
  const { id } = await hub.open({});
  const named = (await (await post("/active", { ids: [id] })).json()) as { terminals: Array<{ id: string; active: boolean }> };
  expect(named.terminals).toMatchObject([{ id, active: false }]);
  expect(((await (await post("/active")).json()) as { terminals: unknown[] }).terminals).toHaveLength(1);
});

test("a malformed request is a 400, an unknown terminal a 404 on the stream, and no terminal host a 503", async () => {
  const { host } = fakeHost();
  const { post } = await serve(new ShellHub(host));
  expect((await post("/open", { cols: -1 })).status).toBe(400);
  expect((await post("/term_nope/stream")).status).toBe(404);

  const bare = await serve(undefined);
  expect((await bare.post("/open")).status).toBe(503);
});

test("an image path is read on this host and comes back as base64, or as its refusal", async () => {
  const { host } = fakeHost();
  const { post } = await serve(new ShellHub(host));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-shell-image-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  fs.writeFileSync(path.join(dir, "a.png"), png);

  expect(await (await post("/image-file", { path: path.join(dir, "a.png") })).json()).toEqual({ ok: true, base64: png.toString("base64") });
  expect(await (await post("/image-file", { path: "relative.png" })).json()).toEqual({ ok: false, code: "EINVAL" });
});
