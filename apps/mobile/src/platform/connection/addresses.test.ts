import { expect, test } from "bun:test";
import { probe, PROBE_TIMEOUT_MS, rankAddresses } from "./addresses";
import { fakeClock, fakeNetwork, identityOf } from "./testing";

const LAN = "http://192.168.1.20:3000";
const TAILNET = "http://100.110.136.102:3000";
const MAGIC = "https://mini.tail.ts.net";
const HOST = "host_00000000-0000-0000-0000-000000000001";

test("tailnet addresses rank before LAN ones, paired before advertised, without duplicates", () => {
  expect(rankAddresses([LAN], [TAILNET, `${LAN}/`, MAGIC])).toEqual([TAILNET, MAGIC, LAN]);
  expect(rankAddresses([MAGIC], [TAILNET])).toEqual([MAGIC, TAILNET]);
});

test("the best-ranked address that names the host wins, even when a worse one answers first", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: () => identityOf(HOST), [LAN]: () => identityOf(HOST) });
  expect((await probe([TAILNET, LAN], HOST, fetch, fakeClock()))?.address).toBe(TAILNET);
});

test("an address answered by another Mac counts as silent", async () => {
  const { fetch } = fakeNetwork({ [TAILNET]: () => identityOf("host_other"), [LAN]: () => identityOf(HOST) });
  expect((await probe([TAILNET, LAN], HOST, fetch, fakeClock()))?.address).toBe(LAN);
  expect(await probe([TAILNET], HOST, fetch, fakeClock())).toBeUndefined();
});

test("an address that never answers is given up on after the probe timeout", async () => {
  const clock = fakeClock();
  const { fetch } = fakeNetwork({ [TAILNET]: () => "hang", [LAN]: () => identityOf(HOST) });
  const found = probe([TAILNET, LAN], HOST, fetch, clock);
  clock.advance(PROBE_TIMEOUT_MS);
  expect((await found)?.address).toBe(LAN);
});
