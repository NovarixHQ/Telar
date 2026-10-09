import { expect, test } from "bun:test";
import { probe, PROBE_TIMEOUT_MS, rankAddresses } from "./addresses";
import { fakeClock, fakeNetwork, identityOf } from "./testing";

const LAN = "http://192.168.1.20:3000";
const TAILNET = "http://100.110.136.102:3000";
const MAGIC = "https://mini.tail.ts.net";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const TARGET = { hostId: HOST, paired: [TAILNET] };

test("tailnet addresses rank before LAN ones, paired before advertised, without duplicates", () => {
  expect(rankAddresses([LAN], [TAILNET, `${LAN}/`, MAGIC])).toEqual([TAILNET, MAGIC, LAN]);
  expect(rankAddresses([MAGIC], [TAILNET])).toEqual([MAGIC, TAILNET]);
});

test("the best-ranked address that names the host wins, even when a worse one answers first", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: () => identityOf(HOST), [LAN]: () => identityOf(HOST) });
  expect((await probe([TAILNET, LAN], TARGET, fetch, fakeClock()))?.address).toBe(TAILNET);
});

test("an address answered by another Mac counts as silent", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: () => identityOf("host_other"), [LAN]: () => identityOf(HOST) });
  expect((await probe([TAILNET, LAN], TARGET, fetch, fakeClock()))?.address).toBe(LAN);
  expect(await probe([TAILNET], TARGET, fetch, fakeClock())).toBeUndefined();
});

test("an address that never answers is given up on after the probe timeout", async () => {
  const clock = fakeClock();
  const { fetch } = fakeNetwork({ [TAILNET]: () => "hang", [LAN]: () => identityOf(HOST) });
  const found = probe([TAILNET, LAN], TARGET, fetch, clock);
  clock.advance(PROBE_TIMEOUT_MS);
  expect((await found)?.address).toBe(LAN);
});

const unauthorized = () => Response.json({ error: { code: "cockpit_unauthorized" } }, { status: 401 });
const pong = () => Response.json({ ok: true, proto: 1, appVersion: "0.1.0" });
const beforeIdentity = (path: string) => (path === "/api/ping" ? pong() : unauthorized());

test("a host too old to name itself is trusted on the address this phone paired with, and nowhere else", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: beforeIdentity, [LAN]: beforeIdentity });
  expect(await probe([TAILNET, LAN], { hostId: HOST, paired: [`${LAN}/`] }, fetch, fakeClock())).toEqual({ address: LAN });
  expect(await probe([TAILNET], { hostId: HOST, paired: [LAN] }, fetch, fakeClock())).toBeUndefined();
});

test("a host paired before it could name itself is still found once updated, on its paired address only", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: () => identityOf("host_updated"), [LAN]: () => identityOf("host_updated") });
  const legacy = { hostId: HOST, paired: [LAN], legacy: true as const };
  expect((await probe([TAILNET, LAN], legacy, fetch, fakeClock()))?.address).toBe(LAN);
});
