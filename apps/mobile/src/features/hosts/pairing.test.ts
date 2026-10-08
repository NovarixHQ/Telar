import { expect, test } from "bun:test";
import { fakeNetwork, identityOf } from "../../platform/connection/testing";
import { pair } from "./pairing";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const LINK = `${MAC}/pair#token=48129037`;

const PHONE = { name: "Telar iPhone", tablet: false };
const paired = () => Response.json({ deviceToken: "tlr_phone", deviceId: "dev_1", deviceName: "iPhone" });

test("a pairing link yields the Mac's lasting id, its name and a device token", async () => {
  const { fetch, seen } = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : paired()) });
  expect(await pair(LINK, PHONE, fetch)).toEqual({
    ok: true,
    host: { hostId: HOST, name: "Mini", token: "tlr_phone", deviceId: "dev_1", paired: [MAC] },
  });
  expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([`GET ${MAC}/api/identity`, `POST ${MAC}/api/pair`]);
});

test("the telar:// form of the link pairs the same way", async () => {
  const { fetch } = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : paired()) });
  const outcome = await pair(`telar://pair?link=${encodeURIComponent(LINK)}`, PHONE, fetch);
  expect(outcome.ok && outcome.host.hostId).toBe(HOST);
});

test("the one-time code is not spent on a Mac too old to say who it is", async () => {
  const { fetch, seen } = fakeNetwork({ [MAC]: () => Response.json({ error: { code: "cockpit_unauthorized" } }, { status: 401 }) });
  expect(await pair(LINK, PHONE, fetch)).toMatchObject({ ok: false, message: expect.stringContaining("too old") });
  expect(seen.some((call) => call.method === "POST")).toBe(false);
});

test("the cockpit's refusal is shown in its own words", async () => {
  const refusal = { error: { code: "cockpit_unauthorized", message: "That pairing code has expired." } };
  const { fetch } = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : Response.json(refusal, { status: 401 })) });
  expect(await pair(LINK, PHONE, fetch)).toEqual({ ok: false, message: "That pairing code has expired." });
});

test("a link that is not a pairing link, and a Mac that is away, explain themselves", async () => {
  const { fetch } = fakeNetwork({});
  expect(await pair("http://mini:3000/", PHONE, fetch)).toMatchObject({ ok: false, message: expect.stringContaining("pairing link") });
  expect(await pair(LINK, PHONE, fetch)).toMatchObject({ ok: false, message: expect.stringContaining("Couldn't reach") });
});

test("the device introduces itself by its own name, as an iPhone or an iPad, and by this install's id", async () => {
  const network = fakeNetwork({ [MAC]: (path) => (path === "/api/identity" ? identityOf(HOST) : paired()) });
  const bodies: unknown[] = [];
  const fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.body) bodies.push(JSON.parse(String(init.body)));
    return network.fetch(input, init);
  }) as typeof globalThis.fetch;
  await pair(LINK, PHONE, fetch);
  await pair(LINK, { name: "Studio iPad", tablet: true, clientId: "9F1C2E4A-7B3D-4C5E-8F6A-0B1C2D3E4F5A" }, fetch);
  expect(bodies).toEqual([
    { token: "48129037", platform: "ios", kind: "phone", machine: "iPhone", os: "iOS", deviceName: "Telar iPhone" },
    { token: "48129037", platform: "ios", kind: "tablet", machine: "iPad", os: "iPadOS", deviceName: "Studio iPad", clientId: "9F1C2E4A-7B3D-4C5E-8F6A-0B1C2D3E4F5A" },
  ]);
});
