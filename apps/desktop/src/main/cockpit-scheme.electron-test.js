const { app, BrowserWindow, protocol, session } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net_ = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { APP_URL, registerCockpitScheme, serveCockpit } = require("./cockpit-scheme");
const { createRemoteHost } = require("./remote-host");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

registerCockpitScheme(protocol);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-scheme-"));
app.setPath("userData", userData);
const remoteHost = createRemoteHost({ dir: userData });

const HOST_TOKEN = "tlr_" + "c".repeat(43);
const repo = path.resolve(__dirname, "..", "..", "..", "..");
const staticDir = path.join(repo, "apps", "web", "out");
const preload = path.join(__dirname, "..", "preload", "preload.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net_.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function until(check, what, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const found = await check();
      if (found) return resolve(found);
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 200);
    };
    void tick();
  });
}

const status = (port, route, headers = {}) =>
  new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: route, headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", () => resolve(0));
  });

const STUB_ACP = `
const readline = require("node:readline");
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (message.method === "session/new") send({ id: message.id, result: { sessionId: "stub" } });
  else if (message.method === "session/prompt") {
    const text = message.params.prompt.map((part) => part.text ?? "").join("");
    send({ method: "session/update", params: { sessionId: "stub", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "echo:" + text.length } } } });
    send({ id: message.id, result: { stopReason: "end_turn" } });
  } else if (message.id !== undefined && message.method) send({ id: message.id, error: { code: -32601, message: "not supported" } });
});
`;

async function engineCall(endpoint, method, route, body) {
  const response = await fetch(`http://${endpoint.host}:${endpoint.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert(response.ok, `${method} ${route} answered ${response.status}: ${text}`);
  return JSON.parse(text);
}

const PAGE_PROMPT = `async ({ sessionId, runId, input, dropped }) => {
  const deadline = (ms, what) => new Promise((resolve) => setTimeout(() => resolve(what), ms));
  for (let index = 0; index < dropped; index++) {
    const controller = new AbortController();
    const opened = await Promise.race([fetch("/v2/sessions/stream", { signal: controller.signal }).then(() => true, () => false), deadline(10000, false)]);
    controller.abort();
    if (!opened) return JSON.stringify({ posted: "stream " + index + " of " + dropped + " never opened", streamed: "", seen: [] });
  }
  const stream = await Promise.race([fetch("/v2/sessions/stream", { headers: { accept: "text/event-stream" } }), deadline(10000, null)]);
  if (!stream) return JSON.stringify({ posted: "the sessions stream never opened", streamed: "", seen: [] });
  const reader = stream.body.getReader();
  const seen = [];
  const watching = (async () => {
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return "the stream ended";
      text += new TextDecoder().decode(value);
      for (const line of text.split("\\n")) if (line.startsWith("data: ") && line.includes(sessionId)) seen.push(JSON.parse(line.slice(6)).type);
      if (seen.includes("turn.completed")) return "completed";
    }
  })();
  const posted = await Promise.race([
    fetch("/v2/sessions/" + sessionId + "/turns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, input }) })
      .then(async (response) => "status " + response.status + (response.ok ? "" : " " + (await response.text()).slice(0, 160)), (error) => "threw " + error),
    deadline(15000, "no answer in 15s"),
  ]);
  const streamed = await Promise.race([watching, deadline(30000, "no turn.completed in 30s")]);
  reader.cancel().catch(() => {});
  return JSON.stringify({ posted, streamed, seen });
}`;

function engineConnections(engine, port) {
  const lines = spawnSync("lsof", ["-nP", "-a", "-p", String(engine.pid), "-iTCP", "-sTCP:ESTABLISHED"], { encoding: "utf8" }).stdout.split("\n");
  return lines.filter((line) => line.includes(`:${port}->`)).length;
}

async function sendPrompt({ window, endpoint, engine, home, note }) {
  const stub = path.join(home, "stub-acp.cjs");
  fs.writeFileSync(stub, STUB_ACP);
  const binary = path.join(home, "stub-acp");
  fs.writeFileSync(binary, `#!/bin/sh\nexec node ${JSON.stringify(stub)} "$@"\n`, { mode: 0o755 });
  const root = fs.mkdtempSync(path.join(home, "project-"));
  await engineCall(endpoint, "PUT", "/v2/provider-instances/stub", { driver: "acp", binaryPath: binary, displayName: "Stub" });
  const { project } = await engineCall(endpoint, "POST", "/v2/projects", { name: "prompt", root });
  const { session } = await engineCall(endpoint, "POST", "/v2/sessions", { projectId: project.id, providerInstanceId: "stub", envMode: "local" });
  const before = engineConnections(engine, endpoint.port);
  const cases = [
    { label: "a prompt", runId: "run_scheme_small", input: "hello", dropped: 0 },
    { label: "a prompt after twenty dropped streams", runId: "run_scheme_dropped", input: "hello again", dropped: 20 },
    { label: "a 190 kB prompt", runId: "run_scheme_large", input: "x".repeat(190_000), dropped: 0 },
  ];
  for (const { label, runId, input, dropped } of cases) {
    const result = JSON.parse(await window.webContents.executeJavaScript(`(${PAGE_PROMPT})(${JSON.stringify({ sessionId: session.id, runId, input, dropped })})`));
    assert(result.posted === "status 202" && result.streamed === "completed", `${label} through telar:// failed: ${JSON.stringify(result)}`);
  }
  note("a prompt sent from the page is accepted, run and streamed back through telar://, also after twenty dropped streams and at 190 kB");
  await until(() => engineConnections(engine, endpoint.port) <= before + 4, `dropped streams to release their engine connections (${before} before)`, 15_000);
  note("streams the page drops close their connections to the engine");
}

async function main() {
  assert(fs.existsSync(path.join(staticDir, "index.html")), `build the cockpit first: bun run --cwd apps/web build:static (${staticDir})`);
  const note = (line) => console.log(`COCKPIT_SCHEME ${line}`);
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-scheme-home-"));
  let engineLog = "";
  const engine = spawn("bun", [path.join(repo, "apps", "engine", "src", "main.ts")], {
    cwd: repo,
    env: {
      ...process.env,
      HOME: home,
      TELAR_HOME: home,
      TELAR_ENGINE_HOST: "127.0.0.1",
      TELAR_ENGINE_PORT: String(port),
      TELAR_HOST_TOKEN: HOST_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine.stdout.on("data", (chunk) => (engineLog = `${engineLog}${chunk}`.slice(-4000)));
  engine.stderr.on("data", (chunk) => (engineLog = `${engineLog}${chunk}`.slice(-4000)));

  const readEndpoint = () => {
    try {
      const { host, port: enginePort, token } = JSON.parse(fs.readFileSync(path.join(home, "engine", "engine.json"), "utf8"));
      return { host, port: enginePort, token };
    } catch {
      return null;
    }
  };
  await app.whenReady();
  serveCockpit(session.defaultSession, { staticDir, engine: readEndpoint });

  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload } });
  try {
    await until(() => status(port, "/v2/ping").then((code) => code === 200), `the engine on :${port}\n${engineLog}`);
    const endpoint = readEndpoint();
    assert(endpoint?.token, "the engine wrote no discovery file");

    const requests = [];
    const finished = [];
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      requests.push(details.url);
      callback({});
    });
    session.defaultSession.webRequest.onCompleted((details) => finished.push({ url: details.url, status: details.statusCode }));

    await window.loadURL(`${APP_URL}projects/project_real/sessions/session_real`);
    const pathname = await window.webContents.executeJavaScript("location.pathname");
    assert(pathname === "/projects/project_real/sessions/session_real", `the address changed to ${pathname}`);
    assert((await window.webContents.executeJavaScript("location.protocol")) === "telar:", "the page is not on telar://");
    note(`served the session page for ${pathname}`);

    await until(() => requests.some((url) => url.includes("/v2/sessions/session_real")), `the cockpit to ask for session_real; it asked for:\n${requests.filter((url) => url.includes("/v2/")).join("\n")}`);
    assert(!requests.some((url) => /\/v2\/sessions\/_(\/|\?|$)/.test(url)), "the cockpit asked for the placeholder session");
    note("the cockpit read the real session id from the address, not the placeholder");

    await until(() => finished.some((entry) => entry.url.includes("/v2/sessions/live") && entry.status === 200), `an authenticated read of the live list; finished:\n${JSON.stringify(finished.filter((entry) => entry.url.includes("/v2/")))}`);
    note("the engine bearer authenticated the page's API calls from the main process");

    const asset = finished.find((entry) => entry.url.includes("/_next/static/"));
    assert(asset && asset.status === 200, "a hashed asset was not served");

    const settings = await session.defaultSession.fetch(`${APP_URL}settings`);
    assert(settings.status === 200, `/settings answered ${settings.status}`);
    assert(settings.headers.get("content-type").startsWith("text/html"), "a page was not served as html");
    assert(settings.headers.get("x-content-type-options") === "nosniff", "nosniff is missing");
    assert(settings.headers.get("referrer-policy") === "no-referrer", "referrer-policy is missing");
    const css = finished.find((entry) => entry.url.endsWith(".css"));
    assert(!css || (await (await session.defaultSession.fetch(css.url)).headers.get("content-type")).startsWith("text/css"), "a stylesheet was not served as css");
    assert((await session.defaultSession.fetch(`${APP_URL}..%2F..%2Fetc%2Fpasswd`)).status === 404, "a path outside the bundle was served");
    assert((await session.defaultSession.fetch("telar://elsewhere/")).status === 404, "another host on the scheme was served");
    note("pages, assets and headers are served from the bundle");

    const leaked = await window.webContents.executeJavaScript(
      `(async () => JSON.stringify({ cookie: document.cookie, bridge: Object.keys(window.telarDesktop ?? {}), body: await (await fetch("/v2/remote")).text() }))()`,
    );
    const seen = JSON.parse(leaked);
    assert(seen.bridge.length > 0 && seen.bridge.includes("browser"), "the preload bridge is missing");
    assert(!seen.cookie.includes("tlr_") && !leaked.includes(endpoint.token) && !leaked.includes(HOST_TOKEN), "the page can read a token");
    note("the preload bridge is present and no token is readable from the page");

    await sendPrompt({ window, endpoint, engine, home, note });

    for (const headers of [{ "x-telar-host": HOST_TOKEN }, { cookie: `telar_device=${HOST_TOKEN}` }, { authorization: `Bearer ${endpoint.token}` }]) {
      assert((await status(port, "/v2/remote", headers)) === 401, `the network listener admitted ${Object.keys(headers)[0]}`);
    }
    assert((await status(endpoint.port, "/v2/remote", { authorization: `Bearer ${endpoint.token}` })) === 200, "the loopback engine refused its own bearer");
    note("the network listener refuses the host token and the engine bearer");

    const minted = await (await fetch(`http://127.0.0.1:${endpoint.port}/v2/remote/pairing`, {
      method: "POST",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: "{}",
    })).json();
    await remoteHost.connect(`http://127.0.0.1:${port}/pair#token=${minted.code}`, "Cockpit scheme test");
    const device = remoteHost.endpoint();
    assert(device?.baseUrl === `http://127.0.0.1:${port}` && device.token.startsWith("tlr_"), "pairing gave no device credential");
    assert((await fs.promises.stat(path.join(userData, "remote-host.json"))).mode % 0o1000 === 0o600, "the credential file is not private");

    session.defaultSession.protocol.unhandle("telar");
    serveCockpit(session.defaultSession, { staticDir, engine: remoteHost.endpoint });
    await window.loadURL(`${APP_URL}settings`);
    const remote = JSON.parse(await window.webContents.executeJavaScript(
      `(async () => JSON.stringify({ cookie: document.cookie, status: (await fetch("/v2/sessions/live")).status, bridge: Object.keys(window.telarDesktop ?? {}) }))()`,
    ));
    assert(remote.status === 200, `the remote read answered ${remote.status}`);
    assert(!remote.cookie.includes("tlr_") && !JSON.stringify(remote).includes(device.token), "the page can read the device credential");
    note("client-only: /v2 reaches the remote listener with the device credential, which the page never holds");

    console.log("COCKPIT_SCHEME_OK");
  } finally {
    window.destroy();
    engine.kill("SIGTERM");
    await new Promise((resolve) => (engine.exitCode === null ? engine.once("exit", resolve) : resolve()));
    fs.rmSync(home, { recursive: true, force: true });
    await removeUserData(userData);
  }
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error("COCKPIT_SCHEME_FAIL", error);
    app.exit(1);
  },
);
