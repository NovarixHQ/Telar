import { expect, test } from "bun:test";
import { fakeNetwork, identityOf } from "../../platform/connection/testing";
import { addressFields, cockpitAddress, connectionRowSubtitle, connectionsSubtitle, probeBanner, testConnection } from "./connect";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const health = (registered = true) => Response.json({ version: 2, daemonId: "daemon_0123456789abcdef", startedAt: 1791483512000, worker: { registered } });

test("the Host and Port fields make a cockpit address, and a known address fills them back", () => {
  expect(cockpitAddress(" mini.tail ", "")).toBe("http://mini.tail:3000");
  expect(cockpitAddress("100.70.1.2", "62051")).toBe("http://100.70.1.2:62051");
  expect(cockpitAddress("https://mini.ts.net/", "3000")).toBe("https://mini.ts.net");
  expect(cockpitAddress("  ", "3000")).toBe("");
  expect(addressFields("http://192.168.86.28:62051")).toEqual({ host: "192.168.86.28", port: "62051" });
  expect(addressFields("https://mini.ts.net")).toEqual({ host: "mini.ts.net", port: "443" });
  expect(addressFields(undefined)).toEqual({ host: "", port: "3000" });
});

test("a reachable engine reports its id, its worker and which computer answered", async () => {
  const { fetch, seen } = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : health(false)) });
  const result = await testConnection(MAC, "tlr_phone", fetch);
  expect(result).toMatchObject({ kind: "ok", daemonId: "daemon_0123456789abcdef", workerRegistered: false, identity: { hostId: HOST } });
  expect(seen[0]).toMatchObject({ url: `${MAC}/api/health`, authorization: "Bearer tlr_phone" });
  expect(probeBanner(result)).toEqual({ icon: "checkmark.circle.fill", tone: "emerald", title: "Connected — engine daemon_0123456…", detail: "No worker registered: turns will queue but not run." });
});

test("a cockpit that refuses the phone but answers ping asks to be paired", async () => {
  const { fetch } = fakeNetwork({ [MAC]: (path) => (path === "/api/ping" ? Response.json({ ok: true }) : Response.json({ error: { code: "cockpit_unauthorized" } }, { status: 401 })) });
  const result = await testConnection(MAC, undefined, fetch);
  expect(result).toEqual({ kind: "unpaired" });
  expect(probeBanner(result)).toMatchObject({ icon: "lock.circle", tone: "amber", title: "Reachable, but this cockpit requires pairing." });
});

test("silence, a down engine and a bad host each say what to check", async () => {
  const away = fakeNetwork({});
  expect(await testConnection(MAC, "tlr_phone", away.fetch)).toEqual({ kind: "failed", message: expect.stringContaining("TELAR_WEB_HOST") });
  const down = fakeNetwork({ [MAC]: () => Response.json({ error: { code: "engine_unavailable", message: "x" } }, { status: 503 }) });
  expect(await testConnection(MAC, "tlr_phone", down.fetch)).toEqual({ kind: "failed", message: "Cockpit answered, but the engine on the computer is down." });
  expect(await testConnection("", "tlr_phone", away.fetch)).toEqual({ kind: "failed", message: "That doesn't look like a host." });
  expect(probeBanner({ kind: "failed", message: "Nope." })).toEqual({ icon: "xmark.circle", tone: "red", title: "Nope." });
});

test("rows say whether this phone holds a credential and where the computer is", () => {
  expect(connectionsSubtitle("tlr_phone", "http://192.168.86.28:62051")).toBe("Paired · 192.168.86.28");
  expect(connectionsSubtitle("", "http://mini.tail:3000")).toBe("Open · mini.tail");
  expect(connectionRowSubtitle("tlr_phone", "http://192.168.86.28:62051")).toBe("192.168.86.28:62051 · paired");
  expect(connectionRowSubtitle("", undefined)).toBe("open");
});
