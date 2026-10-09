import { expect, test } from "bun:test";
import { PushRelay, type Attest, type RelayState } from "./relay";

type Call = { method: string; path: string; body?: string; assertion?: string };
type Answer = { status: number; body?: unknown };

function setup(answer: (call: Call) => Answer, options: { stored?: RelayState; attest?: Partial<Attest>; bundle?: string; now?: () => number } = {}) {
  const calls: Call[] = [];
  const saved: RelayState[] = [];
  const signedOver: string[] = [];
  const attest: Attest = {
    isSupported: true,
    generateKey: async () => "attest-key",
    attestKey: async (keyId, challenge) => `attested(${keyId},${challenge})`,
    generateAssertion: async (_keyId, data) => (signedOver.push(data), `assertion-${signedOver.length}`),
    ...options.attest,
  };
  const fetch = (async (input: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = { method: String(init.method), path: input.replace("https://relay.test", ""), ...(init.body ? { body: String(init.body) } : {}), ...(headers["x-telar-assertion"] ? { assertion: headers["x-telar-assertion"] } : {}) };
    calls.push(call);
    const { status, body } = answer(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  });
  const relay = new PushRelay({
    url: "https://relay.test",
    bundle: options.bundle ?? "io.github.novarix.telar",
    sandbox: false,
    attest,
    fetch,
    load: async () => options.stored && structuredClone(options.stored),
    save: async (state) => void saved.push(structuredClone(state)),
    ...(options.now ? { now: options.now } : {}),
  });
  return { relay, calls, saved, signedOver };
}

const fresh = (call: Call): Answer => {
  if (call.path === "/v2/challenge") return { status: 200, body: { challenge: "c-1" } };
  if (call.path === "/v2/devices") return { status: 201, body: { handle: "handle-1" } };
  if (call.path === "/v2/devices/handle-1/keys") return { status: 201, body: { keyId: "k-1", sendKey: "s-1" } };
  return { status: 500 };
};

test("a first registration attests the challenge, then mints a send key for the computer", async () => {
  const { relay, calls, saved, signedOver } = setup(fresh);
  const credential = await relay.credential("HOST-A", "aa".repeat(32));
  expect(credential).toEqual({ url: "https://relay.test", handle: "handle-1", keyId: "k-1", sendKey: "s-1" });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /v2/challenge", "POST /v2/devices", "POST /v2/devices/handle-1/keys"]);
  expect(JSON.parse(calls[1]!.body!)).toEqual({ keyId: "attest-key", attestation: "attested(attest-key,c-1)", challenge: "c-1", bundle: "io.github.novarix.telar", sandbox: false, token: "aa".repeat(32) });
  expect(signedOver).toEqual([`POST /v2/devices/handle-1/keys\n{"pairing":"HOST-A"}`]);
  expect(calls[2]!.assertion).toBe("assertion-1");
  expect(saved.at(-1)).toMatchObject({ attestKeyId: "attest-key", handle: "handle-1", registered: "aa".repeat(32), keys: { "HOST-A": { keyId: "k-1", sendKey: "s-1" } } });
});

test("a known computer reuses its key and a fresh registration is not refreshed", async () => {
  const stored: RelayState = { attestKeyId: "attest-key", handle: "handle-1", registered: "aa".repeat(32), refreshedAt: 1_000, keys: { "HOST-A": { keyId: "k-1", sendKey: "s-1" } } };
  const { relay, calls } = setup(fresh, { stored, now: () => 2_000 });
  expect(await relay.credential("HOST-A", "aa".repeat(32))).toEqual({ url: "https://relay.test", handle: "handle-1", keyId: "k-1", sendKey: "s-1" });
  expect(calls).toEqual([]);
});

test("a changed token is pushed to the relay, signed", async () => {
  const stored: RelayState = { attestKeyId: "attest-key", handle: "handle-1", registered: "aa".repeat(32), refreshedAt: 1_000, keys: { "HOST-A": { keyId: "k-1", sendKey: "s-1" } } };
  const { relay, calls, signedOver } = setup((call) => (call.method === "PUT" ? { status: 200, body: {} } : fresh(call)), { stored, now: () => 2_000 });
  await relay.credential("HOST-A", "bb".repeat(32));
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["PUT /v2/devices/handle-1"]);
  expect(signedOver).toEqual([`PUT /v2/devices/handle-1\n{"token":"${"bb".repeat(32)}"}`]);
});

test("a handle the relay forgot registers again from scratch", async () => {
  const stored: RelayState = { attestKeyId: "old-key", handle: "gone", registered: "aa".repeat(32), refreshedAt: 0, keys: { "HOST-A": { keyId: "old", sendKey: "old" } } };
  const { relay, calls } = setup((call) => (call.path === "/v2/devices/gone" ? { status: 410 } : fresh(call)), { stored, now: () => 86_400_001 });
  expect(await relay.credential("HOST-A", "aa".repeat(32))).toMatchObject({ handle: "handle-1", keyId: "k-1" });
  expect(calls.map((call) => call.path)).toEqual(["/v2/devices/gone", "/v2/challenge", "/v2/devices", "/v2/devices/handle-1/keys"]);
});

test("a refused attestation or an unsupported device stops asking", async () => {
  const refused = setup((call) => (call.path === "/v2/devices" ? { status: 401 } : fresh(call)));
  expect(await refused.relay.credential("HOST-A", "aa".repeat(32))).toBeUndefined();
  expect(refused.relay.unavailable).toBe(true);

  const unsupported = setup(fresh, { attest: { generateKey: () => Promise.reject(Object.assign(new Error("no"), { code: "ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED" })) } });
  expect(await unsupported.relay.credential("HOST-A", "aa".repeat(32))).toBeUndefined();
  expect(unsupported.relay.unavailable).toBe(true);

  expect(setup(fresh, { bundle: "com.example.other" }).relay.unavailable).toBe(true);
  expect(setup(fresh, { attest: { isSupported: false } }).relay.unavailable).toBe(true);
});

test("a passing relay failure is retried next time", async () => {
  let down = true;
  const { relay } = setup((call) => (down ? { status: 503 } : fresh(call)));
  expect(await relay.credential("HOST-A", "aa".repeat(32))).toBeUndefined();
  expect(relay.unavailable).toBe(false);
  down = false;
  expect(await relay.credential("HOST-A", "aa".repeat(32))).toMatchObject({ keyId: "k-1" });
});

test("revoking a computer drops its key here and at the relay", async () => {
  const stored: RelayState = { attestKeyId: "attest-key", handle: "handle-1", keys: { "HOST-A": { keyId: "k-1", sendKey: "s-1" } } };
  const { relay, calls, saved, signedOver } = setup(() => ({ status: 204 }), { stored });
  await relay.revoke("HOST-A");
  expect(saved.at(-1)?.keys).toEqual({});
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["DELETE /v2/devices/handle-1/keys/k-1"]);
  expect(signedOver).toEqual(["DELETE /v2/devices/handle-1/keys/k-1\n"]);
});
