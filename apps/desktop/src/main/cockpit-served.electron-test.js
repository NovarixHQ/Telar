const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { attachHostHeader } = require("./host-header");
const { removeUserData } = require("../../test/electron/electron-test-teardown");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-served-"));
app.setPath("userData", userData);

const HOST_TOKEN = "tlr_" + "c".repeat(43);
const repo = path.resolve(__dirname, "..", "..", "..", "..");
const staticDir = path.join(repo, "apps", "web", "out");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
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

const ping = (port) =>
  new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/v2/ping`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
  });

async function main() {
  assert(fs.existsSync(path.join(staticDir, "index.html")), `build the cockpit first: bun run --cwd apps/web build:static (${staticDir})`);
  const note = (line) => console.log(`COCKPIT_SERVED ${line}`);
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cockpit-served-home-"));
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
      TELAR_STATIC_DIR: staticDir,
      TELAR_HOST_TOKEN: HOST_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine.stdout.on("data", (chunk) => (engineLog = `${engineLog}${chunk}`.slice(-4000)));
  engine.stderr.on("data", (chunk) => (engineLog = `${engineLog}${chunk}`.slice(-4000)));

  const appUrl = `http://127.0.0.1:${port}/`;
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  try {
    await until(() => ping(port), `the engine on :${port}\n${engineLog}`);
    assert(attachHostHeader(session.defaultSession, { appUrl, token: HOST_TOKEN }), "the header listener did not attach");

    const requests = [];
    const finished = [];
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      requests.push(details.url);
      callback({});
    });
    session.defaultSession.webRequest.onCompleted((details) => finished.push({ url: details.url, status: details.statusCode }));

    await window.loadURL(`${appUrl}projects/project_real/sessions/session_real`);
    const pathname = await window.webContents.executeJavaScript("location.pathname");
    assert(pathname === "/projects/project_real/sessions/session_real", `the address changed to ${pathname}`);
    note(`served the session page for ${pathname}`);

    await until(() => requests.some((url) => url.includes("/v2/sessions/session_real")), `the cockpit to ask for session_real; it asked for:\n${requests.filter((url) => url.includes("/v2/")).join("\n")}`);
    note("the cockpit read the real session id from the address, not the placeholder");
    assert(!requests.some((url) => /\/v2\/sessions\/_(\/|\?|$)/.test(url)), "the cockpit asked for the placeholder session");

    await until(() => finished.some((entry) => entry.url.includes("/v2/sessions/live") && entry.status === 200), `an authenticated read of the live list; finished:\n${JSON.stringify(finished.filter((entry) => entry.url.includes("/v2/")))}`);
    note("the host header authenticated the cockpit's API calls");

    const asset = finished.find((entry) => entry.url.includes("/_next/static/"));
    assert(asset && asset.status === 200, "a hashed asset was not served");

    const stranger = await new Promise((resolve) => http.get(`http://127.0.0.1:${port}/v2/sessions/live`, (response) => { response.resume(); resolve(response.statusCode); }));
    assert(stranger === 401, `an unauthenticated read answered ${stranger}`);

    console.log("COCKPIT_SERVED_OK");
  } finally {
    window.destroy();
    engine.kill("SIGTERM");
    await new Promise((resolve) => (engine.exitCode === null ? engine.once("exit", resolve) : resolve()));
    fs.rmSync(home, { recursive: true, force: true });
    await removeUserData(userData);
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error("COCKPIT_SERVED_FAIL", error);
    app.exit(1);
  },
);
