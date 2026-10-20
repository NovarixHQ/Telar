const { app, BrowserWindow, net, protocol, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net_ = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { APP_URL, registerCockpitScheme, serveCockpit } = require("./cockpit-scheme");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

registerCockpitScheme(protocol);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-scheme-"));
app.setPath("userData", userData);

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
      TELAR_EMBEDDED_WORKER: "0",
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
  serveCockpit(session.defaultSession, { net, staticDir, engine: readEndpoint });

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

    for (const headers of [{ "x-telar-host": HOST_TOKEN }, { cookie: `telar_device=${HOST_TOKEN}` }, { authorization: `Bearer ${endpoint.token}` }]) {
      assert((await status(port, "/v2/remote", headers)) === 401, `the network listener admitted ${Object.keys(headers)[0]}`);
    }
    assert((await status(endpoint.port, "/v2/remote", { authorization: `Bearer ${endpoint.token}` })) === 200, "the loopback engine refused its own bearer");
    note("the network listener refuses the host token and the engine bearer");

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
