import { describe, expect, test } from "bun:test";
import type { EngineEvent, SimulatorInput, SimulatorSummary } from "@telar/engine-client";
import { coalesce, inputQueue, listSimulators, nextOrientation, readScreenConfig, screenMapping, sessionSimulators, simulatorIcon } from "./model";

const sim = (id: string, booted = true, extra: Partial<SimulatorSummary> = {}): SimulatorSummary => ({ id, platform: "ios", name: id, version: "27.0", booted, physical: false, ...extra });
const opened = (id: string) => ({ type: "simulator.opened", simulator: sim(id) }) as unknown as EngineEvent;
const closed = (id: string) => ({ type: "simulator.closed", simulatorId: id }) as unknown as EngineEvent;
const touch = (phase: "begin" | "move" | "end", x = 0.5): SimulatorInput => ({ type: "touch", phase, x, y: 0.5 });

describe("session simulators", () => {
  test("a reopened simulator moves to the end and a closed one leaves", () => {
    expect(sessionSimulators([opened("a"), opened("b"), opened("a"), closed("b")])).toEqual(["a"]);
  });
});

describe("listing", () => {
  test("running ones come first, the session's latest at the top, and ones that can't be shown sink", () => {
    const list = listSimulators([sim("off", false), sim("other"), sim("android", true, { platform: "android" }), sim("mine"), sim("older")], ["older", "mine"]);
    expect(list.map((entry) => entry.id)).toEqual(["mine", "older", "other", "off", "android"]);
  });
});

describe("screen mapping", () => {
  test("a portrait frame is letterboxed into a wide view and a tap maps to the device's unit square", () => {
    const mapping = screenMapping({ width: 100, height: 200 }, { width: 100, height: 200, orientation: "portrait" });
    expect(mapping.fitted({ width: 400, height: 200 })).toEqual({ x: 150, y: 0, width: 100, height: 200 });
    expect(mapping.devicePoint({ x: 175, y: 50 }, { width: 400, height: 200 })).toEqual({ x: 0.25, y: 0.25 });
    expect(mapping.devicePoint({ x: 0, y: 0 }, { width: 400, height: 200 })).toEqual({ x: 0, y: 0 });
  });

  test("a device turned left draws its portrait frame sideways and maps taps back to it", () => {
    const mapping = screenMapping({ width: 100, height: 200 }, { width: 100, height: 200, orientation: "landscape_left" });
    expect(mapping.sideways).toBe(true);
    expect(mapping.fitted({ width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(mapping.devicePoint({ x: 50, y: 25 }, { width: 200, height: 100 })).toEqual({ x: 0.25, y: 0.75 });
  });

  test("a frame that already arrives landscape is drawn as it comes", () => {
    expect(screenMapping({ width: 200, height: 100 }, { width: 200, height: 100, orientation: "landscape_left" }).rotation).toBe(0);
  });
});

test("a simulator paired with a phone is a watch", () => {
  expect(simulatorIcon(sim("w", true, { pairedWith: "phone" }))).toBe("applewatch");
  expect(simulatorIcon(sim("p"))).toBe("iphone");
});

test("rotation cycles through all four orientations", () => {
  expect(nextOrientation("portrait")).toBe("landscape_left");
  expect(nextOrientation("landscape_right")).toBe("portrait");
});

test("a config without numbers is ignored and an unknown orientation reads as portrait", () => {
  expect(readScreenConfig({ width: "x" })).toBeUndefined();
  expect(readScreenConfig({ width: 1, height: 2, orientation: "sideways" })).toEqual({ width: 1, height: 2, orientation: "portrait" });
});

test("only the last of consecutive moves survives coalescing", () => {
  expect(coalesce([touch("begin"), touch("move", 0.1), touch("move", 0.2), touch("end")])).toEqual([touch("begin"), touch("move", 0.2), touch("end")]);
});

test("input queued while a batch is in flight goes out next, coalesced", async () => {
  const sent: SimulatorInput[][] = [];
  let release: () => void = () => {};
  const failures: unknown[] = [];
  const queue = inputQueue(
    (events) => {
      sent.push(events);
      return new Promise<void>((resolve) => (release = resolve));
    },
    (failure) => failures.push(failure),
  );
  queue.send(touch("begin"));
  queue.send(touch("move", 0.1));
  queue.send(touch("move", 0.2));
  queue.send(touch("end"));
  expect(sent).toEqual([[touch("begin")]]);
  release();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(sent[1]).toEqual([touch("move", 0.2), touch("end")]);
  expect(failures).toEqual([undefined]);
});
