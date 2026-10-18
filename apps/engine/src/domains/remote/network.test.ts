import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
  const remote = (method: string, route: string, init: { token?: string; body?: unknown; host?: string } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
      const request = http.request(
        { host: daemon.network!.host, port: daemon.network!.port, path: route, method, headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.host ? { host: init.host } : {}) } },
        (response) => {
          let text = "";
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text ? JSON.parse(text) : null }));
        },
      );
      request.on("error", reject);
      request.end(init.body === undefined ? undefined : JSON.stringify(init.body));
    });
  const pair = async (role?: "observer") => {
    const code = ((await (await loopback("POST", "/v2/remote/pairing")).json()) as { code: string }).code;
    const paired = await remote("POST", "/v2/remote/pair", { body: { code, name: role ? "Viewer" : "Phone" } });
    if (role) await loopback("PATCH", `/v2/remote/devices/${paired.body.deviceId}`, { role });
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
  expect((await remote("GET", "/v2/ping")).status).toBe(200);
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
  expect((await remote("POST", "/v2/auth/decide", { token: daemon.discovery.token, body: {} })).status).toBe(401);
  expect((await remote("POST", "/v2/mcp", { token: daemon.discovery.token, body: {} })).status).toBe(401);
});

test("a View-only device can read but not write, and turning requireAuth off does not open the network", async () => {
  const { loopback, remote, pair } = await engine({ host: "127.0.0.1" });
  const full = await pair();
  const viewer = await pair("observer");
  expect((await remote("GET", "/v2/remote", { token: viewer })).status).toBe(200);
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
