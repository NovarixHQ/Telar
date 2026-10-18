import { expect, test } from "bun:test";
import { ENGINE_PROTO } from "@telar/engine-client";
import { RECORDED_HOSTS, recordedFetch } from "@telar/engine-client/fixtures/hosts";
import { HostConnection, type HostRecord } from "./host-connection";
import { hostProto, speaksV2 } from "./proto";
import { fakeClock, fakeNetwork, identityOf, until } from "./testing";

const LAN = "http://192.168.1.20:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const record: HostRecord = { hostId: HOST, name: "Mini", token: "tlr_phone", paired: [LAN] };

const newHost = (path: string) => (path === "/v2/ping" ? Response.json({ ok: true, proto: ENGINE_PROTO }) : path === "/v2/identity" ? identityOf(HOST) : Response.json({ sessions: [] }));

test("a host that reports the current proto is spoken to on /v2", async () => {
  const network = fakeNetwork({ [LAN]: newHost }, { speaksV2: true });
  const connection = new HostConnection(record, { fetch: network.fetch, clock: fakeClock() });
  connection.start();
  await until(connection, "online");
  await connection.request("GET", "/v2/sessions/live");
  expect(network.seen.map((call) => call.url).slice(-1)).toEqual([`${LAN}/v2/sessions/live`]);
  expect(network.seen.at(-1)?.authorization).toBe("Bearer tlr_phone");
  connection.stop();
});

test("a host with no /v2/ping is spoken to through the /api alias", async () => {
  const network = fakeNetwork({ [LAN]: (path) => (path === "/api/identity" ? identityOf(HOST) : Response.json({ sessions: [] })) });
  const connection = new HostConnection(record, { fetch: network.fetch, clock: fakeClock() });
  connection.start();
  await until(connection, "online");
  await connection.request("GET", "/v2/sessions/live");
  expect(network.seen.at(-1)?.url).toBe(`${LAN}/api/sessions/live`);
  connection.stop();
});

test("a host that answers ping with an older proto stays on /api", async () => {
  const answer = fakeNetwork({ [LAN]: () => Response.json({ ok: true, proto: ENGINE_PROTO - 1 }) }, { speaksV2: true });
  expect(await hostProto(LAN, answer.fetch)).toBe(ENGINE_PROTO - 1);
  expect(speaksV2(ENGINE_PROTO - 1)).toBe(false);
  expect(speaksV2(ENGINE_PROTO)).toBe(true);
});

for (const host of RECORDED_HOSTS) {
  test(`the recorded ${host.version} host is not taken for a /v2 host`, async () => {
    expect(speaksV2(await hostProto("http://100.70.1.2:3000", recordedFetch(host)))).toBe(false);
  });
}
