const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCockpitHandler, serveDevCockpit } = require("./cockpit-scheme");

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "telar-scheme-"));
  fs.mkdirSync(path.join(root, "_next", "static"), { recursive: true });
  fs.mkdirSync(path.join(root, "projects", "_", "sessions"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<html>home</html>");
  fs.writeFileSync(path.join(root, "settings.html"), "<html>settings</html>");
  fs.writeFileSync(path.join(root, "projects", "_", "sessions", "_.html"), "<html>session</html>");
  fs.writeFileSync(path.join(root, "projects", "_", "sessions", "_.txt"), "payload");
  fs.writeFileSync(path.join(root, "_next", "static", "app.js"), "1");
  fs.writeFileSync(path.join(root, "secret.txt"), "outside");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const endpoint = { host: "127.0.0.1", port: 4100, token: "engine-secret" };
function handler({ engine = () => endpoint, fetchImpl = async () => new Response("{}") } = {}) {
  return createCockpitHandler({ staticDir: path.join(root, "."), engine, fetchImpl });
}
const get = (pathname, init) => handler()(new Request(`telar://app${pathname}`, init));

describe("static files", () => {
  test("serve with their own MIME type and the engine's security headers", async () => {
    const response = await get("/_next/static/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  test("pages resolve without an extension, and real ids fall back to the placeholder page", async () => {
    expect(await (await get("/")).text()).toBe("<html>home</html>");
    expect(await (await get("/settings")).text()).toBe("<html>settings</html>");
    expect(await (await get("/projects/project_1/sessions/session_9")).text()).toBe("<html>session</html>");
    expect(await (await get("/projects/project_1/sessions/session_9.txt")).text()).toBe("payload");
    expect((await get("/settings")).headers.get("cache-control")).toBe("no-cache");
  });

  test("a path that climbs out of the bundle, or names nothing, is a 404", async () => {
    expect((await get("/..%2Fsecret.txt")).status).toBe(404);
    expect((await get("/%00")).status).toBe(404);
    expect((await get("/nothing/here")).status).toBe(404);
  });

  test("another host on the scheme is refused, and a page takes no writes", async () => {
    expect((await handler()(new Request("telar://elsewhere/"))).status).toBe(404);
    expect((await get("/settings", { method: "POST", body: "x" })).status).toBe(405);
  });
});

describe("the engine", () => {
  test("/v2 reaches the loopback engine with its bearer, and the page's own credentials are dropped", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json", "set-cookie": "a=b", "content-length": "11" } });
    };
    const response = await handler({ fetchImpl })(
      new Request("telar://app/v2/sessions?limit=2", {
        method: "POST",
        body: '{"x":1}',
        headers: { "content-type": "application/json", authorization: "Bearer page", cookie: "telar_device=x", origin: "telar://app" },
      }),
    );
    expect(seen[0].url).toBe("http://127.0.0.1:4100/v2/sessions?limit=2");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.headers.get("authorization")).toBe("Bearer engine-secret");
    expect(seen[0].init.headers.get("cookie")).toBeNull();
    expect(seen[0].init.headers.get("origin")).toBeNull();
    expect(seen[0].init.headers.get("content-type")).toBe("application/json");
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });

  test("a remote computer is reached at its own address with its device token", async () => {
    const seen = [];
    const remote = { baseUrl: "https://mini.tail.ts.net:443", token: "tlr_device" };
    const fetchImpl = async (url, init) => (seen.push({ url, init }), new Response("{}"));
    await handler({ engine: () => remote, fetchImpl })(new Request("telar://app/v2/sessions/live?x=1", { headers: { authorization: "Bearer page" } }));
    expect(seen[0].url).toBe("https://mini.tail.ts.net:443/v2/sessions/live?x=1");
    expect(seen[0].init.headers.get("authorization")).toBe("Bearer tlr_device");
  });

  test("the engine's token never appears in anything the page can read", async () => {
    const response = await handler({ fetchImpl: async () => new Response("ok", { headers: { "x-test": "1" } }) })(new Request("telar://app/api/ping"));
    expect([...response.headers.values()].join(" ")).not.toContain("engine-secret");
  });

  test("a missing or unreachable engine answers 503 and 502 instead of throwing", async () => {
    expect((await handler({ engine: () => null })(new Request("telar://app/v2/ping"))).status).toBe(503);
    const down = handler({ fetchImpl: async () => Promise.reject(new Error("ECONNREFUSED")) });
    expect((await down(new Request("telar://app/v2/ping"))).status).toBe(502);
  });

  test("an event stream reaches the page as the engine writes it", async () => {
    let push;
    const fetchImpl = async () => new Response(new ReadableStream({ start: (controller) => (push = controller) }), { headers: { "content-type": "text/event-stream" } });
    const response = await handler({ fetchImpl })(new Request("telar://app/v2/sessions/stream"));
    const reader = response.body.getReader();
    push.enqueue(new TextEncoder().encode("data: 1\n\n"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
  });

  test("a page that drops a stream closes the engine connection behind it", async () => {
    const signals = [];
    const fetchImpl = async (_url, init) => (signals.push(init.signal), new Response(new ReadableStream({ pull: () => new Promise(() => {}) })));
    const run = handler({ fetchImpl });
    await (await run(new Request("telar://app/v2/sessions/stream"))).body.cancel();
    const page = new AbortController();
    await run(new Request("telar://app/v2/sessions/stream", { signal: page.signal }));
    page.abort();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
  });

  test("the engine is read per request, so a restarted engine's new token is used", async () => {
    let token = "first";
    const seen = [];
    const run = handler({ engine: () => ({ ...endpoint, token }), fetchImpl: async (_url, init) => (seen.push(init.headers.get("authorization")), new Response("{}")) });
    await run(new Request("telar://app/v2/ping"));
    token = "second";
    await run(new Request("telar://app/v2/ping"));
    expect(seen).toEqual(["Bearer first", "Bearer second"]);
  });
});

describe("the dev cockpit", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  function serve() {
    const engineCalls = [];
    const passed = [];
    let handle;
    globalThis.fetch = async (target, init) => (engineCalls.push({ target: String(target), init }), new Response("{}"));
    const net = { fetch: async (target, init) => (passed.push({ target: String(target?.url ?? target), init }), new Response("{}")) };
    serveDevCockpit({ protocol: { handle: (_scheme, handler) => (handle = handler) } }, { net, origin: "http://127.0.0.1:3000", engine: () => endpoint });
    return { engineCalls, passed, handle: (url, init) => handle(new Request(url, init)) };
  }

  test("/v2 on the dev origin goes to the engine with its bearer; everything else passes through untouched", async () => {
    const { engineCalls, passed, handle } = serve();
    await handle("http://127.0.0.1:3000/v2/sessions/live");
    await handle("http://127.0.0.1:3000/settings");
    await handle("http://127.0.0.1:9999/v2/sessions/live");
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0].target).toBe("http://127.0.0.1:4100/v2/sessions/live");
    expect(engineCalls[0].init.headers.get("authorization")).toBe("Bearer engine-secret");
    expect(passed.map((call) => call.target)).toEqual(["http://127.0.0.1:3000/settings", "http://127.0.0.1:9999/v2/sessions/live"]);
    expect(passed.map((call) => call.init)).toEqual([{ bypassCustomProtocolHandlers: true }, { bypassCustomProtocolHandlers: true }]);
  });
});
