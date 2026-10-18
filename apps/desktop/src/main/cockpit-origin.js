const http = require("node:http");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { session } = require("electron");
const { attachHostHeader } = require("./host-header");
const { jsonPrefs } = require("./prefs");

const HOST_TOKEN = process.env.TELAR_HOST_TOKEN || "tlr_" + randomBytes(32).toString("base64url");

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const portPrefs = jsonPrefs(
  "server-port.json",
  null,
  (data) => {
    const port = Number(data.port);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  },
  "port",
);

async function getStablePort() {
  const stored = portPrefs.read();
  if (stored !== null && (await isPortFree(stored))) return stored;
  const fresh = await findFreePort();
  portPrefs.write({ port: fresh });
  return fresh;
}

function seatHostHeader(url) {
  if (!attachHostHeader(session.defaultSession, { appUrl: url, token: HOST_TOKEN })) {
    console.error(`[telar-desktop] could not attach the host header for ${url}; the window falls back to its cookie.`);
  }
}

async function seatHostCookie(url) {
  try {
    const { protocol, host } = new URL(url);
    await session.defaultSession.cookies.set({
      url: `${protocol}//${host}`,
      name: "telar_device",
      value: HOST_TOKEN,
      httpOnly: true,
      sameSite: "lax",
    });
  } catch {
  }
}

function waitForCockpit(port, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/v2/ping`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(port);
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(2_000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error(`the engine did not answer on :${port} within ${timeoutMs}ms`));
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

module.exports = { HOST_TOKEN, findFreePort, getStablePort, seatHostHeader, seatHostCookie, waitForCockpit };
