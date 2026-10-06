import { expect, test } from "bun:test";
import { CONNECTED_WINDOW_MS, createPresence } from "./presence";

function clocked() {
  let now = 1_000_000;
  const presence = createPresence(() => now);
  return { presence, advance: (ms: number) => (now += ms), now: () => now };
}

test("a device that passed the gate just now is connected and was last seen then", () => {
  const { presence, now } = clocked();
  presence.seen("dev_1");
  expect(presence.of("dev_1")).toEqual({ connected: true, lastSeenAt: now() });
});

test("a device goes quiet once the window passes with no request", () => {
  const { presence, advance } = clocked();
  presence.seen("dev_1");
  advance(CONNECTED_WINDOW_MS - 1);
  expect(presence.of("dev_1").connected).toBe(true);
  advance(1);
  expect(presence.of("dev_1").connected).toBe(false);
});

test("each request keeps a device connected", () => {
  const { presence, advance } = clocked();
  presence.seen("dev_1");
  advance(CONNECTED_WINDOW_MS - 1);
  presence.seen("dev_1");
  advance(CONNECTED_WINDOW_MS - 1);
  expect(presence.of("dev_1").connected).toBe(true);
});

test("a device not seen since the engine started falls back to the stored time and is not connected", () => {
  const { presence } = clocked();
  expect(presence.of("dev_2", 500)).toEqual({ connected: false, lastSeenAt: 500 });
  expect(presence.of("dev_3")).toEqual({ connected: false });
});

test("the live time wins over the coarser stored one", () => {
  const { presence, now } = clocked();
  presence.seen("dev_1");
  expect(presence.of("dev_1", now() - 45_000).lastSeenAt).toBe(now());
});
