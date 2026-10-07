import { expect, test } from "bun:test";
import type { SimulatorSummary } from "@telar/engine-client";
import { installTestDom } from "@/test/dom";
import { dockSimulator, dragFloat, FLOAT_GAP, floatKey, floatSimulator, keepFloatSpot, placeFloat, resizeFloat } from "./float";

installTestDom();

const room = { width: 800, height: 600 };
const aspect = 0.5;
const iPhone: SimulatorSummary = { id: "A1B2", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: true, physical: false };

test("a fresh float sits in the top-right corner at the device's aspect ratio", () => {
  const frame = placeFloat(undefined, aspect, room);
  expect(frame.width / frame.height).toBe(aspect);
  expect(frame.x + frame.width).toBe(room.width - FLOAT_GAP);
  expect(frame.y).toBe(FLOAT_GAP);
});

test("a saved spot outside a smaller cockpit is pulled back inside and shrunk to fit", () => {
  const frame = placeFloat({ x: 700, y: 500, width: 400 }, aspect, { width: 500, height: 400 });
  expect(frame).toEqual({ x: 500 - FLOAT_GAP - 188, y: FLOAT_GAP, width: 188, height: 376 });
});

test("a drag moves the float with the pointer and stops at the cockpit's edges", () => {
  const start = { x: 100, y: 100, width: 200, height: 400 };
  expect(dragFloat(start, { x: 50, y: -20 }, room)).toEqual({ ...start, x: 150, y: 80 });
  expect(dragFloat(start, { x: -500, y: 500 }, room)).toEqual({ ...start, x: FLOAT_GAP, y: room.height - FLOAT_GAP - 400 });
});

test("a corner resize keeps the aspect ratio, holds the opposite corner and stays inside the cockpit", () => {
  const start = { x: 300, y: 100, width: 100, height: 200 };
  expect(resizeFloat(start, "se", { x: 40, y: 0 }, aspect, room)).toEqual({ x: 300, y: 100, width: 140, height: 280 });
  expect(resizeFloat(start, "nw", { x: -20, y: -100 }, aspect, room)).toEqual({ x: 256, y: FLOAT_GAP, width: 144, height: 288 });
  const grown = resizeFloat(start, "se", { x: 2000, y: 0 }, aspect, room);
  expect(grown.y + grown.height).toBe(room.height - FLOAT_GAP);
  expect(grown.width / grown.height).toBe(aspect);
});

test("each session keeps its own spot, and docking keeps the spot for the next float", () => {
  const one = floatKey(undefined, "session_one");
  const two = floatKey("host_b", "session_one");
  floatSimulator(one, iPhone);
  keepFloatSpot(one, { x: 40, y: 50, width: 160, height: 320 });
  dockSimulator(one);
  const stored = JSON.parse(localStorage.getItem("telar:simulator-float") ?? "{}");
  expect(stored[one]).toEqual({ spot: { x: 40, y: 50, width: 160 } });
  expect(stored[two]).toBeUndefined();
});
