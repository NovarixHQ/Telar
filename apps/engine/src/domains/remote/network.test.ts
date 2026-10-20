import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ENGINE_PROTO } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function engine(network?: { host: string }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-network-"));
  roots.push(home);
  const daemon = await startEngine({ models: stubModels, engineRoot: path.join(home, "engine"), ...(network ? { network } : {}) });
  daemons.push(daemon);
  const loopback = (method: string, route: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${daemon.discovery.port}${route}`, {
      method,
      headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const remote = (method: string, route: string, init: { token?: string; body?: unknown; host?: string; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
      const request = http.request(
        { host: daemon.network!.host, port: daemon.network!.port, path: route, method, headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.host ? { host: init.host } : {}), ...init.headers } },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text ? JSON.parse(text) : null }));
        },
      );
      request.on("error", reject);
      request.end(init.body === undefined ? undefined : JSON.stringify(init.body));
    });
  const pair = async (scopes?: string[]) => {
    const code = ((await (await loopback("POST", "/v2/remote/pairing")).json()) as { code: string }).code;
    const paired = await remote("POST", "/v2/remote/pair", { body: { code, name: scopes ? scopes.join("+") : "Phone" } });
    if (scopes) await loopback("PATCH", `/v2/remote/devices/${paired.body.deviceId}`, { scopes });
    return paired.body.deviceToken as string;
  };
  return { daemon, loopback, remote, pair };
}

test("without TELAR_ENGINE_HOST there is no network listener", async () => {
  const { daemon } = await engine();
  expect(daemon.network).toBeUndefined();
  expect(daemon.discovery.host).toBe("127.0.0.1");
});

test("ping and pair are open on the network listener; everything else needs a device", async () => {
  const { remote, pair } = await engine({ host: "127.0.0.1" });
  const ping = await remote("GET", "/v2/ping");
  expect(ping.status).toBe(200);
  expect(ping.body).toMatchObject({ ok: true, proto: ENGINE_PROTO });
  expect((await remote("GET", "/v2/sessions")).status).toBe(401);
  expect((await remote("GET", "/v2/health")).status).toBe(401);
  expect((await remote("POST", "/v2/remote/pairing")).status).toBe(401);
  const token = await pair();
  expect(token).toMatch(/^tlr_/);
  expect((await remote("GET", "/v2/health", { token })).status).toBe(200);
});

test("the engine token opens nothing on the network listener", async () => {
  const { daemon, remote } = await engine({ host: "127.0.0.1" });
  expect((await remote("GET", "/v2/health", { token: daemon.discovery.token })).status).toBe(401);
  expect((await remote("POST", "/v2/mcp", { token: daemon.discovery.token, body: {} })).status).toBe(401);
});

test("a device reaches only the routes its scopes cover, and turning requireAuth off does not open the network", async () => {
  const { loopback, remote, pair } = await engine({ host: "127.0.0.1" });
  const full = await pair();
  const viewer = await pair(["read"]);
  const editor = await pair(["read", "write"]);
  expect((await remote("GET", "/v2/health", { token: viewer })).status).toBe(200);
  expect((await remote("GET", "/v2/remote", { token: viewer })).status).toBe(403);
  expect((await remote("GET", "/v2/remote", { token: editor })).status).toBe(403);
  expect((await remote("POST", "/v2/remote/pairing", { token: editor })).status).toBe(403);
  expect((await remote("GET", "/v2/remote", { token: full })).status).toBe(200);
  expect((await remote("POST", "/v2/remote/pairing", { token: viewer })).status).toBe(403);
  expect((await remote("POST", "/v2/remote/pairing", { token: full })).status).toBe(200);
  await loopback("PATCH", "/v2/remote", { requireAuth: false });
  expect((await remote("GET", "/v2/health")).status).toBe(401);
});

test("a Host that is not this machine's is refused, and no CORS header is sent", async () => {
  const { remote } = await engine({ host: "127.0.0.1" });
  expect((await remote("GET", "/v2/ping", { host: "evil.example" })).status).toBe(421);
  const answer = await remote("GET", "/v2/ping");
  expect(Object.keys(answer.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
});

test("a browser pairs for a strict HttpOnly cookie that reads freely but writes only from this host's own pages", async () => {
  const { daemon, loopback, remote } = await engine({ host: "127.0.0.1" });
  const code = ((await (await loopback("POST", "/v2/remote/pairing")).json()) as { code: string }).code;
  const paired = await remote("POST", "/v2/remote/pair", { body: { code, name: "Safari", platform: "browser" }, headers: { "x-forwarded-proto": "https" } });
  const setCookie = String(paired.headers["set-cookie"]);
  expect(setCookie).toMatch(/^telar_device=tlr_/);
  for (const attribute of ["HttpOnly", "SameSite=Strict", "Secure"]) expect(setCookie).toContain(attribute);
  const cookie = setCookie.split(";")[0]!;
  expect((await remote("GET", "/v2/health", { headers: { cookie } })).status).toBe(200);
  const write = (origin?: string) => remote("POST", "/v2/remote/pairing", { headers: { cookie, ...(origin ? { origin } : {}) } });
  expect((await write()).status).toBe(403);
  expect((await write("https://evil.example")).status).toBe(403);
  expect((await write("http://127.0.0.1")).status).toBe(403);
  expect((await write(`http://127.0.0.1:${daemon.network!.port}`)).status).toBe(200);
  expect((await remote("POST", "/v2/remote/pairing", { token: paired.body.deviceToken })).status).toBe(200);
});

test("a cookie stops working when its device is revoked, and an iOS pairing sets none", async () => {
  const { loopback, remote } = await engine({ host: "127.0.0.1" });
  const pairAs = async (platform: string) => {
    const code = ((await (await loopback("POST", "/v2/remote/pairing")).json()) as { code: string }).code;
    return remote("POST", "/v2/remote/pair", { body: { code, name: platform, platform } });
  };
  expect((await pairAs("ios")).headers["set-cookie"]).toBeUndefined();
  const browser = await pairAs("browser");
  const cookie = String(browser.headers["set-cookie"]).split(";")[0]!;
  expect((await remote("GET", "/v2/health", { headers: { cookie } })).status).toBe(200);
  await loopback("DELETE", `/v2/remote/devices/${browser.body.deviceId}`);
  expect((await remote("GET", "/v2/health", { headers: { cookie } })).status).toBe(401);
});

test("a stranger learns this host's identity and addresses, and nothing else", async () => {
  const { daemon, remote } = await engine({ host: "127.0.0.1" });
  const identity = await remote("GET", "/v2/identity");
  expect(identity.status).toBe(200);
  expect(identity.body.hostId).toMatch(/^host_/);
  expect(Array.isArray(identity.body.addresses)).toBe(true);
  expect((await remote("GET", "/v2/remote")).status).toBe(401);
  expect(daemon.network!.port).toBeGreaterThan(0);
});

test("the legacy pairing shape names the device from what the engine observes and sets the cookie", async () => {
  const { loopback, remote } = await engine({ host: "127.0.0.1" });
  const code = ((await (await loopback("POST", "/v2/remote/pairing")).json()) as { code: string }).code;
  const paired = await remote("POST", "/v2/pair", { body: { token: code, platform: "browser" }, headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" } });
  expect(paired.status).toBe(200);
  expect(paired.body.deviceName).toMatch(/^Safari on /);
  expect(String(paired.headers["set-cookie"])).toMatch(/^telar_device=tlr_/);
  const devices = (await (await loopback("GET", "/v2/remote")).json()) as { devices: { name: string; identity?: { kind: string; client?: string } }[] };
  expect(devices.devices[0]?.identity).toMatchObject({ kind: "phone", client: "Safari", os: "iOS" });
  const refused = await remote("POST", "/v2/pair", { body: { token: code } });
  expect(refused.status).toBe(401);
});

test("the remote status names the caller, a device that turns auth on is paired in the same answer, and signing out the others keeps it", async () => {
  const { daemon, loopback, remote, pair } = await engine({ host: "127.0.0.1" });
  const token = await pair();
  await pair(["read"]);
  const status = await remote("GET", "/v2/remote", { token });
  expect(status.body.callerDeviceId).toMatch(/^dev_/);
  expect(status.body.callerRole).toBe("full");
  expect(status.body.endpoints.map((endpoint: { url: string }) => endpoint.url)).toEqual([`http://127.0.0.1:${daemon.network!.port}`]);
  expect(((await (await loopback("GET", "/v2/remote")).json()) as { callerDeviceId?: string }).callerDeviceId).toBeUndefined();

  const enabled = await remote("PATCH", "/v2/remote", { token, body: { requireAuth: true } });
  expect(enabled.status).toBe(200);
  expect(enabled.body.deviceToken).toBeUndefined();
  expect(String(enabled.headers["set-cookie"])).toMatch(/^telar_device=tlr_/);

  const revoked = await remote("DELETE", "/v2/remote/devices", { token });
  expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);
  expect((await remote("GET", "/v2/remote", { token })).status).toBe(200);
});

test("the mobile push paths act on the calling device and refuse an unpaired or oversized caller", async () => {
  const { loopback, remote, pair } = await engine({ host: "127.0.0.1" });
  const token = await pair();
  const viewer = await pair(["read"]);
  expect((await remote("GET", "/v2/mobile/push", { token })).body.configured).toBe(false);
  expect((await loopback("GET", "/v2/mobile/push")).status).toBe(401);
  expect((await remote("PUT", "/v2/mobile/push", { token, body: { nonsense: true } })).status).toBe(400);
  expect((await remote("PUT", "/v2/mobile/push", { token, body: { padding: "x".repeat(40_000) } })).status).toBe(413);
  expect((await remote("PUT", "/v2/mobile/push", { token: viewer, body: {} })).status).toBe(403);
  expect((await remote("GET", "/v2/mobile/read-state", { token })).status).toBe(400);
  expect((await loopback("GET", "/v2/mobile/read-state?ids=a")).status).toBe(401);
});

test("a stream ticket admits a hub read on the network listener, and nothing else", async () => {
  const { loopback, remote } = await engine({ host: "127.0.0.1" });
  const { ticket } = (await (await loopback("GET", "/v2/simulators/stream-ticket")).json()) as { ticket: string };
  const stream = "/v2/simulators/hub/vendor/serve-sim/helper/A1B2/stream.mjpeg";
  expect((await remote("GET", `${stream}?ticket=${ticket}`)).status).not.toBe(401);
  expect((await remote("GET", `${stream}?ticket=stk_forged`)).status).toBe(401);
  expect((await remote("POST", `${stream}?ticket=${ticket}`)).status).toBe(401);
  expect((await remote("GET", `/v2/simulators?ticket=${ticket}`)).status).toBe(401);
});

test("the desktop shell's host token opens nothing on the network listener, as a header or a cookie", async () => {
  process.env.TELAR_HOST_TOKEN = "tlr_" + "h".repeat(43);
  try {
    const { remote } = await engine({ host: "127.0.0.1" });
    expect((await remote("GET", "/v2/remote", { headers: { "x-telar-host": process.env.TELAR_HOST_TOKEN } })).status).toBe(401);
    expect((await remote("GET", "/v2/remote", { headers: { cookie: `telar_device=${process.env.TELAR_HOST_TOKEN}` } })).status).toBe(401);
  } finally {
    delete process.env.TELAR_HOST_TOKEN;
  }
});

test("the legacy /api paths reach the same routes, open or gated alike", async () => {
  const { remote, pair } = await engine({ host: "127.0.0.1" });
  expect((await remote("GET", "/api/ping")).status).toBe(200);
  expect((await remote("GET", "/api/identity")).status).toBe(200);
  expect((await remote("GET", "/api/health")).status).toBe(401);
  expect((await remote("GET", "/api/health", { token: await pair() })).status).toBe(200);
});
