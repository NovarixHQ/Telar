import { expect, test } from "bun:test";
import { keyboardOverlap } from "./keyboard-overlap";

test("a full-screen iPhone is covered by the keyboard's whole height", () => {
  expect(keyboardOverlap({ screenX: 0, screenY: 508, width: 402, height: 366 }, { width: 402, height: 874 })).toBe(366);
});

test("a full-screen iPad is covered by the keyboard's whole height", () => {
  expect(keyboardOverlap({ screenX: 0, screenY: 1012, width: 1032, height: 364 }, { width: 1032, height: 1376 })).toBe(364);
});

test("an iPad split-view window is covered only where the screen-wide keyboard meets it", () => {
  expect(keyboardOverlap({ screenX: -516, screenY: 1012, width: 1032, height: 364 }, { width: 516, height: 1376 })).toBe(364);
  expect(keyboardOverlap({ screenX: 0, screenY: 900, width: 1032, height: 364 }, { width: 516, height: 1200 })).toBe(300);
});

test("the hardware-keyboard shortcut bar covers only the strip on screen", () => {
  expect(keyboardOverlap({ screenX: 0, screenY: 1321, width: 1032, height: 364 }, { width: 1032, height: 1376 })).toBe(55);
});

test("a closed, floating or off-window keyboard covers nothing", () => {
  expect(keyboardOverlap({ screenX: 0, screenY: 874, width: 402, height: 366 }, { width: 402, height: 874 })).toBe(0);
  expect(keyboardOverlap({ screenX: 0, screenY: 0, width: 0, height: 0 }, { width: 1032, height: 1376 })).toBe(0);
  expect(keyboardOverlap({ screenX: 300, screenY: 700, width: 320, height: 250 }, { width: 1032, height: 1376 })).toBe(0);
  expect(keyboardOverlap({ screenX: 520, screenY: 1012, width: 400, height: 364 }, { width: 516, height: 1376 })).toBe(0);
});
