import { expect, test } from "bun:test";
import type { RelayCredential } from "./relay";
import { PushSync, type PushHost, type PushPrefs, type PushRegistration, type PushSyncDeps } from "./registration";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function setup(overrides: Partial<PushSyncDeps> = {}) {
  const sent: PushRegistration[] = [];
  const revoked: string[] = [];
  let paired: PushHost[] = [A, B].map((hostId, i) => ({ hostId, name: `Mac ${i}`, register: async (body) => (sent.push(body), { configured: true }) }));
  let prefs: PushPrefs = { notifications: true, completions: true, previews: false, sound: "felt" };
  const sync = new PushSync({
    topic: "io.github.novarix.telar",
    sandbox: false,
    simulator: false,
    hosts: () => paired,
    prefs: () => prefs,
    allowed: async () => true,
    credential: async (hostId, token): Promise<RelayCredential> => ({ url: "https://relay", handle: "h", keyId: `key-${hostId}`, sendKey: token }),
    revoke: async (hostId) => void revoked.push(hostId),
    ...overrides,
  });
  return { sync, sent, revoked, setPaired: (next: PushHost[]) => (paired = next), setPrefs: (next: PushPrefs) => (prefs = next) };
}

test("nothing is sent before APNs hands over a token", async () => {
  const { sync, sent } = setup();
  await sync.sync();
  expect(sent).toEqual([]);
});

test("the token goes to every paired computer with its own relay key", async () => {
  const { sync, sent } = setup();
  await sync.setToken("ab".repeat(32));
  expect(sent.map((body) => body.hostId).sort()).toEqual([A, B]);
  expect(sent.find((body) => body.hostId === A)).toEqual({
    hostId: A,
    token: "ab".repeat(32),
    topic: "io.github.novarix.telar",
    sandbox: false,
    enabled: true,
    completions: true,
    previews: false,
    sounds: "felt",
    mutedSessions: [],
    liveActivities: false,
    hostName: "Mac 0",
    relay: { url: "https://relay", handle: "h", keyId: `key-${A}`, sendKey: "ab".repeat(32) },
  });
});

test("a new token re-registers everywhere; the same token does not", async () => {
  const { sync, sent } = setup();
  await sync.setToken("aa".repeat(32));
  await sync.setToken("aa".repeat(32));
  expect(sent).toHaveLength(2);
  await sync.setToken("bb".repeat(32));
  expect(sent).toHaveLength(4);
  expect(sent.slice(2).every((body) => body.token === "bb".repeat(32))).toBe(true);
});

test("a refused system permission registers as disabled", async () => {
  const { sync, sent } = setup({ allowed: async () => false });
  await sync.setToken("aa".repeat(32));
  expect(sent.every((body) => body.enabled === false)).toBe(true);
});

test("the simulator tells the host so and asks the relay for nothing", async () => {
  let asked = 0;
  const { sync, sent } = setup({ simulator: true, sandbox: true, credential: async () => (asked++, undefined) });
  await sync.setToken("aa".repeat(32));
  expect(asked).toBe(0);
  expect(sent.every((body) => body.simulator === true && body.sandbox && body.relay === undefined)).toBe(true);
});

test("a forgotten computer has its relay key revoked", async () => {
  const { sync, revoked, setPaired } = setup();
  await sync.setToken("aa".repeat(32));
  setPaired([{ hostId: A, name: "Mac 0", register: async () => ({ configured: true }) }]);
  await sync.sync();
  expect(revoked).toEqual([B]);
});

test("calls during a sync fold into one more pass that sees the latest settings", async () => {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const inFlight = new Promise<void>((resolve) => (entered = resolve));
  const seen: boolean[] = [];
  const { sync, setPrefs } = setup({
    hosts: () => [{ hostId: A, name: "Mac", register: async (body) => (seen.push(body.previews), entered(), await gate, {}) }],
  });
  const first = sync.setToken("aa".repeat(32));
  await inFlight;
  setPrefs({ notifications: true, completions: true, previews: true, sound: "hilo" });
  void sync.sync();
  void sync.sync();
  release();
  await first;
  expect(seen).toEqual([false, true]);
});

test("one computer that does not answer does not stop the others", async () => {
  const sent: string[] = [];
  const { sync } = setup({
    hosts: () => [
      { hostId: A, name: "down", register: async () => Promise.reject(new Error("offline")) },
      { hostId: B, name: "up", register: async (body) => (sent.push(body.hostId), {}) },
    ],
  });
  await sync.setToken("aa".repeat(32));
  expect(sent).toEqual([B]);
});
