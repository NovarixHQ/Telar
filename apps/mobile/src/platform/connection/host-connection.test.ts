import { expect, test } from "bun:test";
import { HostConnection, type HostRecord } from "./host-connection";
import { HostRegistry } from "./hosts";
import { fakeClock, fakeNetwork, identityOf, until } from "./testing";

const LAN = "http://192.168.1.20:3000";
const TAILNET = "http://100.110.136.102:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const record: HostRecord = { hostId: HOST, name: "Mini", token: "tlr_phone", paired: [LAN] };

type Mac = (path: string, init: RequestInit) => Response | "unreachable" | "hang";
const mac = (routes: Record<string, () => Response | "unreachable" | "hang">, hostId = HOST): Mac => (path) =>
  path === "/api/identity" ? identityOf(hostId, [TAILNET, LAN]) : (routes[path]?.() ?? Response.json({ error: { code: "not_found" } }, { status: 404 }));

function connect(macs: Record<string, Mac>, clock = fakeClock()) {
  const network = fakeNetwork(macs);
  const connection = new HostConnection(record, { fetch: network.fetch, clock, random: () => 0 });
  connection.start();
  return { connection, network, clock };
}

test("it goes online at the paired address and learns the advertised ones, tailnet first", async () => {
  const { connection } = connect({ [LAN]: mac({}) });
  expect(await until(connection, "online")).toMatchObject({ address: LAN });
  expect(connection.addresses()).toEqual([TAILNET, LAN]);
});

test("requests reach the engine through the cockpit's /api routes with the device token", async () => {
  const { connection, network } = connect({ [LAN]: mac({ "/api/sessions/live": () => Response.json({ sessions: [] }) }) });
  await until(connection, "online");
  expect(await connection.request<{ sessions: [] }>("GET", "/v2/sessions/live")).toEqual({ sessions: [] });
  expect(network.seen.at(-1)).toEqual({ url: `${LAN}/api/sessions/live`, method: "GET", authorization: "Bearer tlr_phone" });
});

test("a Mac that is away is retried after the backoff, and is online once it answers", async () => {
  let away = true;
  const clock = fakeClock();
  const { connection } = connect({ [LAN]: (path, init) => (away ? "unreachable" : mac({})(path, init)) }, clock);
  expect(await until(connection, "backoff")).toMatchObject({ attempt: 1, retryAt: clock.now() + 1_000 });
  away = false;
  clock.advance(1_000);
  expect(await until(connection, "online")).toMatchObject({ address: LAN });
});

test("another Mac answering at the paired address is never sent the token", async () => {
  const { connection, network } = connect({ [LAN]: mac({}, "host_other") });
  await until(connection, "backoff");
  expect(network.seen.every((call) => call.authorization === undefined)).toBe(true);
});

test("a 401 blocks the host until it is paired again, and keeps the token", async () => {
  const { connection } = connect({ [LAN]: mac({ "/api/sessions/live": () => Response.json({ error: { code: "cockpit_unauthorized" } }, { status: 401 }) }) });
  await until(connection, "online");
  await expect(connection.request("GET", "/api/sessions/live")).rejects.toMatchObject({ status: 401 });
  expect(connection.state).toEqual({ kind: "blocked", reason: "unauthorized" });
  connection.wake("reconnect");
  expect(connection.state.kind).toBe("blocked");
});

test("a read that loses its address is retried once on the next one that answers", async () => {
  let lanUp = true;
  const answer = () => Response.json({ ok: true });
  const { connection, network } = connect({
    [LAN]: (path, init) => (lanUp ? mac({ "/api/health": answer })(path, init) : "unreachable"),
    [TAILNET]: (path, init) => (lanUp ? "unreachable" : mac({ "/api/health": answer })(path, init)),
  });
  await until(connection, "online");
  lanUp = false;
  expect(await connection.request<{ ok: boolean }>("GET", "/api/health")).toEqual({ ok: true });
  expect(connection.state).toMatchObject({ kind: "online", address: TAILNET });
  expect(network.seen.at(-1)?.url).toBe(`${TAILNET}/api/health`);
});

test("a write that loses its address fails to the caller instead of being sent twice", async () => {
  let lanUp = true;
  const { connection, network } = connect({
    [LAN]: (path, init) => (lanUp ? mac({})(path, init) : "unreachable"),
    [TAILNET]: (path, init) => (lanUp ? "unreachable" : mac({})(path, init)),
  });
  await until(connection, "online");
  lanUp = false;
  await expect(connection.request("POST", "/api/sessions/s1/turns", { text: "hi" })).rejects.toMatchObject({ code: "engine_unavailable" });
  expect(network.seen.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("stopping aborts what is in flight as an abort, never as an outage", async () => {
  const { connection } = connect({ [LAN]: mac({ "/api/sessions/live": () => "hang" }) });
  await until(connection, "online");
  const pending = connection.request("GET", "/api/sessions/live");
  connection.stop();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(connection.state.kind).toBe("stopped");
});

test("the registry keeps one connection per host and removing one leaves the others alone", async () => {
  const other = "host_00000000-0000-0000-0000-000000000002";
  const network = fakeNetwork({ [LAN]: mac({}), [TAILNET]: mac({}, other) });
  const registry = new HostRegistry({ fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  const mini = registry.add(record);
  const studio = registry.add({ hostId: other, name: "Studio", token: "tlr_b", paired: [TAILNET] });
  expect(registry.add({ ...record, token: "tlr_new" })).toBe(mini);
  await until(studio, "online");
  registry.remove(HOST);
  expect(registry.list()).toEqual([studio]);
  expect(mini.state.kind).toBe("stopped");
  expect(studio.state.kind).toBe("online");
});
