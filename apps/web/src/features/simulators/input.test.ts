import { expect, test } from "bun:test";
import type { SimulatorInput } from "@telar/engine-client";
import { hidUsage, inputQueue, rawPoint } from "./input";

test("keys map to their HID usage, and keys the simulator has no usage for are dropped", () => {
  expect(hidUsage("KeyA")).toBe(0x04);
  expect(hidUsage("KeyZ")).toBe(0x1d);
  expect(hidUsage("Digit1")).toBe(0x1e);
  expect(hidUsage("Digit0")).toBe(0x27);
  expect(hidUsage("Enter")).toBe(0x28);
  expect(hidUsage("F5")).toBeUndefined();
});

test("a touch on a turned screen is turned back into the portrait framebuffer", () => {
  const portrait = { width: 1179, height: 2556 };
  expect(rawPoint(0.2, 0.3, { ...portrait, orientation: "portrait" })).toEqual({ x: 0.2, y: 0.3 });
  expect(rawPoint(0.2, 0.3, { ...portrait, orientation: "landscape_left" })).toEqual({ x: 0.3, y: 0.8 });
  expect(rawPoint(0.25, 0.5, { ...portrait, orientation: "portrait_upside_down" })).toEqual({ x: 0.75, y: 0.5 });
  expect(rawPoint(0.2, 0.3, { width: 2556, height: 1179, orientation: "landscape_left" })).toEqual({ x: 0.2, y: 0.3 });
});

test("while a request is out, moves collapse into the latest and presses are all kept", async () => {
  const batches: SimulatorInput[][] = [];
  let release!: () => void;
  const enqueue = inputQueue((events) => {
    batches.push(events);
    return batches.length === 1 ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve();
  }, () => undefined);
  enqueue({ type: "touch", phase: "begin", x: 0, y: 0 });
  enqueue({ type: "touch", phase: "move", x: 0.1, y: 0 });
  enqueue({ type: "touch", phase: "move", x: 0.2, y: 0 });
  enqueue({ type: "touch", phase: "end", x: 0.2, y: 0 });
  release();
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  await Promise.resolve();
  expect(batches).toEqual([
    [{ type: "touch", phase: "begin", x: 0, y: 0 }],
    [{ type: "touch", phase: "move", x: 0.2, y: 0 }, { type: "touch", phase: "end", x: 0.2, y: 0 }],
  ]);
});
