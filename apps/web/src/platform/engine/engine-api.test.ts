import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DEFAULT_INBOX_POLICY, EngineClient } from "@telar/engine-client";
import { stubModels } from "../../../../engine/test/stub-models";
import { catchAll as liveGet } from "@/test/catch-all";
import { engineApi } from "./engine-api";
import { createHostsStore } from "../../../../engine/src/domains/hosts";
import { startEngine, type EngineDaemon } from "../../../../engine/src/daemon";

describe("the catch-all forwards what the engine stamped on the live list", () => {
  const saved = { home: process.env.TELAR_HOME, cockpit: process.env.TELAR_COCKPIT };
  let root: string;
  let daemon: EngineDaemon;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-live-route-"));
    process.env.TELAR_HOME = root;
    process.env.TELAR_COCKPIT = "1";
    daemon = await startEngine({ engineRoot: path.join(root, "engine") });
    const client = new EngineClient(daemon.discovery);
    await client.registerProject({ id: "project_one", name: "One", root });
    await client.createSession({ id: "session_open", projectId: "project_one" });
    await client.createSession({ id: "session_done", projectId: "project_one" });
    await client.settleSession("session_done", true);
  });

  afterAll(async () => {
    await daemon.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [["TELAR_HOME", saved.home], ["TELAR_COCKPIT", saved.cockpit]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const read = (query = "", headers: Record<string, string> = {}) => liveGet(new Request(`http://cockpit.test/api/sessions/live${query}`, { headers }));

  test("the engine's identity and settling window reach a browser", async () => {
    const body = await (await read()).json();
    expect(typeof body.daemonId).toBe("string");
    expect(body.inbox).toMatchObject({ autoSettleAfterHours: DEFAULT_INBOX_POLICY.autoSettleAfterHours });
  });

  test("the default read leaves the shelf out and counts it; ?all=1 brings it", async () => {
    const narrow = await (await read()).json();
    expect(narrow.sessions.map((session: { id: string }) => session.id)).toEqual(["session_open"]);
    expect(narrow.settledCount).toBe(1);
    const wide = await (await read("?all=1")).json();
    expect(wide.sessions.map((session: { id: string }) => session.id).sort()).toEqual(["session_done", "session_open"]);
  });

  test("the first read carries a tag out, and handing it back is answered 304", async () => {
    const first = await read();
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const again = await read("", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
  });

  test("?shelf=1 answers the settled rows alone, under a tag of its own", async () => {
    const shelf = await read("?shelf=1");
    expect((await shelf.json()).sessions.map((session: { id: string }) => session.id)).toEqual(["session_done"]);
    expect((await read("?shelf=1", { "if-none-match": shelf.headers.get("etag")! })).status).toBe(304);
  });

  test("a narrow tag is not spent against the whole list", async () => {
    const etag = (await read()).headers.get("etag")!;
    const wide = await read("?all=1", { "if-none-match": etag });
    expect(wide.status).toBe(200);
  });

  test("the revision cursor still answers a caller that sends one and no tag", async () => {
    const { revision } = await (await read()).json();
    expect(await (await read(`?since=${revision}`)).json()).toMatchObject({ unchanged: true, revision });
  });
});

const segments = (...path: string[]) => ({ params: Promise.resolve({ path }) });

describe("the catch-all reaches only what the cockpit's routes reached", () => {
  const saved = { home: process.env.TELAR_HOME, cockpit: process.env.TELAR_COCKPIT };
  const closers: (() => unknown)[] = [];

  afterAll(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    for (const [key, value] of [["TELAR_HOME", saved.home], ["TELAR_COCKPIT", saved.cockpit]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function cockpit(otherMac?: http.RequestListener): Promise<{ hostId: string }> {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-engine-api-"));
    closers.push(() => fs.rmSync(home, { recursive: true, force: true }));
    process.env.TELAR_HOME = home;
    process.env.TELAR_COCKPIT = "1";
    const remoteDir = path.join(home, "remote");
    let hostId = "";
    if (otherMac) {
      const mac = http.createServer(otherMac);
      await new Promise<void>((resolve) => mac.listen(0, "127.0.0.1", resolve));
      closers.push(() => new Promise((resolve) => mac.close(resolve)));
      hostId = createHostsStore(remoteDir).add({ baseUrl: `http://127.0.0.1:${(mac.address() as { port: number }).port}`, deviceToken: "tlr_remote", name: "mini" }).id;
    }
    const daemon = await startEngine({ engineRoot: path.join(home, "engine"), remoteDir });
    closers.push(() => daemon.close());
    return { hostId };
  }

  test("a write and its query string arrive, and the engine's refusal keeps its status", async () => {
    await cockpit();
    const created = await engineApi(new Request("http://cockpit.test/api/engine/v2/projects", { method: "POST", body: JSON.stringify({ name: "One", root: os.tmpdir() }) }), segments("v2", "projects"));
    expect(created.status).toBe(201);
    const missing = await engineApi(new Request("http://cockpit.test/api/engine/v2/sessions/session_nope"), segments("v2", "sessions", "session_nope"));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  test("the engine's host-only and device doors are not reachable through it", async () => {
    await cockpit();
    for (const path of [["v2", "auth", "decide"], ["v2", "auth", "identify"], ["v2", "devices"], ["v2", "remote"], ["v2", "remote", "devices"], ["v2", "remote", "pairing"], ["v2", "push", "devices", "d1"], ["v2", "mcp"], ["api", "projects"], []]) {
      const answer = await engineApi(new Request(`http://cockpit.test/api/engine/${path.join("/")}`, { method: "POST", body: "{}" }), segments(...path));
      expect(answer.status).toBe(404);
    }
    expect((await engineApi(new Request("http://cockpit.test/api/engine/v2/remote/devices/d1", { method: "PATCH", body: "{}" }), segments("v2", "remote", "devices", "d1"))).status).not.toBe(404);
  });

  test("another Mac is reached through the engine, which alone holds that Mac's token", async () => {
    const seen: { authorization?: string; cookie?: string }[] = [];
    const { hostId } = await cockpit((request, response) => {
      seen.push({ authorization: request.headers.authorization, cookie: request.headers.cookie });
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url!.endsWith("/stream")) return void response.writeHead(200, { "content-type": "text/event-stream" }).end("data: 1\n\n");
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: request.url, body: Buffer.concat(chunks).toString() }));
      });
    });
    const read = await engineApi(new Request(`http://cockpit.test/api/engine/v2/hosts/${hostId}/api/projects/a b?x=1`, { headers: { cookie: "telar_device=local" } }), segments("v2", "hosts", hostId, "api", "projects", "a b"));
    expect(await read.json()).toEqual({ path: "/api/projects/a%20b?x=1", body: "" });
    expect(read.headers.get("telar-host")).toBe("mini");
    const write = await engineApi(new Request(`http://cockpit.test/api/engine/v2/hosts/${hostId}/api/sessions/s1/turns`, { method: "POST", body: '{"input":"hi"}' }), segments("v2", "hosts", hostId, "api", "sessions", "s1", "turns"));
    expect(((await write.json()) as { body: string }).body).toBe('{"input":"hi"}');
    const stream = await engineApi(new Request(`http://cockpit.test/api/engine/v2/hosts/${hostId}/api/sessions/s1/run/stream`), segments("v2", "hosts", hostId, "api", "sessions", "s1", "run", "stream"));
    expect(await stream.text()).toBe("data: 1\n\n");
    expect(seen.every((hop) => hop.authorization === "Bearer tlr_remote" && hop.cookie === undefined)).toBe(true);
    expect((await engineApi(new Request("http://cockpit.test/api/engine/v2/hosts/host_nope/api/projects"), segments("v2", "hosts", "host_nope", "api", "projects"))).status).toBe(404);
  });

  test("a /compact gesture keeps its kind on the way to the engine", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-engine-api-"));
    closers.push(() => fs.rmSync(home, { recursive: true, force: true }));
    process.env.TELAR_HOME = home;
    process.env.TELAR_COCKPIT = "1";
    const daemon = await startEngine({ engineRoot: path.join(home, "engine"), models: stubModels, embeddedWorker: true });
    closers.push(() => daemon.close());
    const client = new EngineClient(daemon.discovery);
    await client.registerProject({ id: "project_one", name: "One", root: home });
    await client.createSession({ id: "session_compact", projectId: "project_one" });
    const sent = await engineApi(new Request("http://cockpit.test/api/engine/v2/sessions/session_compact/turns", { method: "POST", body: JSON.stringify({ runId: "run_c1", input: "/compact", kind: "compact" }) }), segments("v2", "sessions", "session_compact", "turns"));
    expect(sent.status).toBe(202);
    expect((await client.session("session_compact")).turns[0]).toMatchObject({ runId: "run_c1", kind: "compact" });
  });
});
