const { afterEach, expect, test } = require("bun:test");
const crypto = require("node:crypto");
const http = require("node:http");
const { createEngineNotices, discoveryEndpoint, MESSAGES_PATH, STREAM_PATH } = require("./engine-notices");
const { createDesktopNotifier } = require("./desktop-notifications");

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const turnOf = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition) {
  while (!condition()) await turnOf();
}

async function fakeEngine({ refuse = false } = {}) {
  const posted = [];
  const streams = [];
  const auth = [];
  const server = http.createServer((request, response) => {
    auth.push(request.headers.authorization);
    if (request.method === "GET" && request.url === STREAM_PATH) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": open\n\n");
      streams.push(response);
      return;
    }
    if (request.method === "POST" && request.url === MESSAGES_PATH) {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        posted.push(JSON.parse(body));
        response.writeHead(refuse ? 403 : 200).end("{}");
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => { for (const stream of streams) stream.destroy(); server.close(resolve); }));
  const port = server.address().port;
  const connected = async (count = 1) => {
    await until(() => streams.length >= count);
    return streams.at(-1);
  };
  const emit = (message) => streams.at(-1).write(`data: ${JSON.stringify(message)}\n\n`);
  return { port, posted, auth, streams, connected, emit, discovery: { host: "127.0.0.1", port, token: "engine-token" } };
}

function follow(endpoint, options = {}) {
  const received = [];
  const notices = createEngineNotices({ onMessage: (message) => received.push(message), ...options });
  cleanups.push(() => notices.stop());
  notices.start(endpoint);
  return { notices, received };
}

test("notices on the local engine's stream reach the shell, one per data frame", async () => {
  const engine = await fakeEngine();
  const { received } = follow(discoveryEndpoint("engine.json", () => engine.discovery));
  const stream = await engine.connected();
  stream.write(`data: ${JSON.stringify({ type: "telar:desktop-notification", sessionId: "s1" })}\n\n`);
  stream.write(`data: not json\n\ndata: ${JSON.stringify({ type: "telar:desktop-notification:dismiss", sessionId: "s1" })}\n\n`);
  await until(() => received.length === 2);
  expect(received.map((message) => message.type)).toEqual(["telar:desktop-notification", "telar:desktop-notification:dismiss"]);
  expect(engine.auth[0]).toBe("Bearer engine-token");
});

test("a paired host's stream is followed at its address with the device token", async () => {
  const host = await fakeEngine();
  const { received } = follow(() => ({ baseUrl: `http://127.0.0.1:${host.port}`, token: "tlr_device" }));
  await host.connected();
  host.emit({ type: "telar:desktop-notification", sessionId: "s1" });
  await until(() => received.length === 1);
  expect(host.auth).toEqual(["Bearer tlr_device"]);
});

test("a dropped stream is followed again", async () => {
  const host = await fakeEngine();
  const { received } = follow(() => ({ baseUrl: `http://127.0.0.1:${host.port}`, token: "tlr_device" }), { retryMs: 1 });
  (await host.connected()).end();
  await host.connected(2);
  host.emit({ type: "telar:desktop-notification", sessionId: "s2" });
  await until(() => received.length === 1);
  expect(received[0].sessionId).toBe("s2");
});

test("approvals are posted to the engine", async () => {
  const engine = await fakeEngine();
  const { notices, received } = follow(discoveryEndpoint("engine.json", () => engine.discovery));
  await notices.send({ type: "telar:desktop-notification:approve", sessionId: "s1", requestId: "r1" });
  expect(engine.posted).toEqual([{ type: "telar:desktop-notification:approve", sessionId: "s1", requestId: "r1" }]);
  expect(received).toEqual([]);
});

test("with nothing to reach it keeps trying, and an approval that cannot be sent is answered not ok", async () => {
  let reads = 0;
  const { notices, received } = follow(discoveryEndpoint("engine.json", () => { reads += 1; return null; }), { retryMs: 60_000 });
  await notices.send({ type: "telar:desktop-notification:approve", sessionId: "s1", requestId: "r1" });
  expect(reads).toBe(2);
  expect(received).toEqual([{ type: "telar:desktop-notification:approved", sessionId: "s1", requestId: "r1", ok: false }]);
});

test("a stopped subscription can start again", async () => {
  const engine = await fakeEngine();
  const notices = createEngineNotices({ onMessage: () => {} });
  cleanups.push(() => notices.stop());
  notices.start(discoveryEndpoint("engine.json", () => engine.discovery));
  await engine.connected();
  notices.stop();
  notices.start(discoveryEndpoint("engine.json", () => engine.discovery));
  await engine.connected(2);
  expect(engine.auth).toEqual(["Bearer engine-token", "Bearer engine-token"]);
});

class FakeNotification {
  static made = [];
  static remove() {}
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.closed = false;
    FakeNotification.made.push(this);
  }
  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }
  show() {}
  close() {
    this.closed = true;
    this.handlers.close?.();
  }
}

async function clientOnlyDesktop({ refuse = false, enabled = () => true } = {}) {
  FakeNotification.made = [];
  const host = await fakeEngine({ refuse });
  const opened = [];
  let notifier;
  const notices = createEngineNotices({ onMessage: (message) => notifier.handleServerMessage(message) });
  cleanups.push(() => notices.stop());
  notifier = createDesktopNotifier({
    Notification: FakeNotification,
    send: notices.send,
    context: () => ({}),
    open: (route) => opened.push(route),
    chime: { options: () => ({}), shown() {} },
    enabled,
  });
  notices.start(() => ({ baseUrl: `http://127.0.0.1:${host.port}`, token: "tlr_device" }));
  await host.connected();
  return { host, notifier, opened };
}

const notice = (sessionId, extra = {}) => ({
  type: "telar:desktop-notification", kind: "blocked", id: crypto.createHash("sha256").update(sessionId).digest("hex"), sessionId,
  title: "Fix the build", body: "A session needs your input or approval.", path: `/projects/p1/sessions/${sessionId}`, ...extra,
});

test("client-only: the paired host's notice pops, and closes when it is read on another client", async () => {
  const { host, notifier } = await clientOnlyDesktop();
  host.emit(notice("s1"));
  host.emit(notice("s2"));
  await until(() => notifier.liveCount() === 2);
  host.emit({ type: "telar:desktop-notification:dismiss", sessionId: "s1" });
  await until(() => notifier.liveCount() === 1);
  expect(FakeNotification.made.map((banner) => banner.closed)).toEqual([true, false]);
});

test("client-only: muted notifications do not pop", async () => {
  let on = false;
  let asked = 0;
  const { host } = await clientOnlyDesktop({ enabled: () => (asked += 1) && on });
  host.emit(notice("s1"));
  await until(() => asked === 1);
  on = true;
  host.emit(notice("s2"));
  await until(() => FakeNotification.made.length === 1);
  expect(FakeNotification.made[0].options.id).toBe(notice("s2").id);
});

test("client-only: Approve the host refuses opens the session instead", async () => {
  const { host, opened } = await clientOnlyDesktop({ refuse: true });
  host.emit(notice("s1", { request: "r1" }));
  await until(() => FakeNotification.made.length === 1);
  FakeNotification.made[0].handlers.action({ actionIndex: 0 });
  await until(() => opened.length === 1);
  expect(host.posted).toEqual([{ type: "telar:desktop-notification:approve", sessionId: "s1", requestId: "r1" }]);
  expect(opened).toEqual(["/projects/p1/sessions/s1"]);
});
