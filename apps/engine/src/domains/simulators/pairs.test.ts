import { expect, test } from "bun:test";
import { iPhone, pixel, simctlWithPair, WATCH_ID } from "../../../test/fake-simulator-hub";
import { parseWatches, withWatches } from "./pairs";

test("a paired watch is read with its watchOS version, state and iPhone, and an unpaired watch is left out", () => {
  expect(parseWatches(simctlWithPair())).toEqual([
    { id: WATCH_ID, platform: "ios", name: "Pulso Watch", version: "watchOS 27.0", booted: true, physical: false, pairedWith: "A1B2-UDID" },
  ]);
});

test("output that is not simctl JSON lists no watches", () => {
  expect(parseWatches("")).toEqual([]);
  expect(parseWatches(JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.watchOS-27-0": "nope" } }))).toEqual([]);
});

test("a watch sits right after its iPhone, one whose iPhone is not listed goes last, and one already listed is not repeated", () => {
  const [watch] = parseWatches(simctlWithPair());
  const orphan = { ...watch!, id: "ORPHAN", pairedWith: "GONE" };
  expect(withWatches([iPhone(), pixel()], [orphan, watch!]).map((device) => device.id)).toEqual(["A1B2-UDID", WATCH_ID, "Pixel_8", "ORPHAN"]);
  expect(withWatches([iPhone(), watch!], [watch!]).map((device) => device.id)).toEqual(["A1B2-UDID", WATCH_ID]);
});
