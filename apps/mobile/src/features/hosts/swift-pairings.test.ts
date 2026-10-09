import { expect, test } from "bun:test";
import type { PairedHost } from "./pairing";
import { adoptSwiftPairings, swiftHosts, type AdoptDeps, type SwiftStore } from "./swift-pairings";

const ID = "6F1C2D3E-4A5B-4C6D-8E7F-90A1B2C3D4E5";
const OPEN = "0B1C2D3E-4A5B-4C6D-8E7F-90A1B2C3D4E5";

// Swift's JSONEncoder output for [Host]: dates as seconds since 2001.
const book = JSON.stringify([
  { id: ID, name: "Studio", baseURLString: "http://studio.local:4318", addresses: ["http://studio.local:4318", "http://100.64.0.2:4318"], pairedURLString: "http://192.168.1.9:4318", addedAt: 781_000_000, migratedFromSingle: false },
  { id: OPEN, name: "", baseURLString: "http://lab.lan:4318", addedAt: 781_000_100 },
  { id: "broken", name: "No address" },
]);

const store = (hosts: string | null, tokens: Record<string, string> = { [`deviceToken.${ID}`]: "fixture-token" }): SwiftStore => ({ hosts: () => hosts, token: (account) => tokens[account] ?? null });

test("each saved Swift host becomes a host this app can reach, with its Keychain token", () => {
  expect(swiftHosts(store(book))).toEqual([
    { hostId: `host_${ID.toLowerCase()}`, name: "Studio", token: "fixture-token", paired: ["http://192.168.1.9:4318", "http://studio.local:4318", "http://100.64.0.2:4318"], deviceId: "", legacy: true },
    { hostId: `host_${OPEN.toLowerCase()}`, name: "lab.lan", token: "", paired: ["http://lab.lan:4318"], deviceId: "", legacy: true },
  ]);
});

test("nothing saved, or something unreadable, adopts nothing", () => {
  expect(swiftHosts(store(null))).toEqual([]);
  expect(swiftHosts(store("{not json"))).toEqual([]);
  expect(swiftHosts(store('{"hosts":[]}'))).toEqual([]);
});

function deps(over: Partial<AdoptDeps> = {}) {
  const saved: PairedHost[][] = [];
  let done = false;
  const value: AdoptDeps = { store: store(book), done: () => done, markDone: () => void (done = true), save: async (hosts) => void saved.push(hosts), ...over };
  return { value, saved, isDone: () => done };
}

test("adopting runs once, keeps what this app already had and saves the union", async () => {
  const mine: PairedHost = { hostId: "host_mine", name: "Mine", token: "t", paired: ["http://mine.local:4318"], deviceId: "d" };
  const { value, saved, isDone } = deps();
  const hosts = await adoptSwiftPairings([mine], value);
  expect(hosts.map((host) => host.hostId)).toEqual(["host_mine", `host_${ID.toLowerCase()}`, `host_${OPEN.toLowerCase()}`]);
  expect(saved).toEqual([hosts]);
  expect(isDone()).toBe(true);
  expect(await adoptSwiftPairings([mine], value)).toEqual([mine]);
  expect(saved).toHaveLength(1);
});

test("a host already adopted is not added twice", async () => {
  const { value } = deps();
  const first = await adoptSwiftPairings([], value);
  const again = await adoptSwiftPairings(first, { ...value, done: () => false });
  expect(again).toEqual(first);
});

test("a build without the native reader waits for one that has it", async () => {
  const { value, isDone, saved } = deps({ store: null });
  expect(await adoptSwiftPairings([], value)).toEqual([]);
  expect(isDone()).toBe(false);
  expect(saved).toEqual([]);
});

test("a failed save leaves adoption to the next launch", async () => {
  const { value, isDone } = deps({ save: () => Promise.reject(new Error("keychain locked")) });
  await expect(adoptSwiftPairings([], value)).rejects.toThrow("keychain locked");
  expect(isDone()).toBe(false);
});
