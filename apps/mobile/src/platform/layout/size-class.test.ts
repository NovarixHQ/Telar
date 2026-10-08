import { expect, test } from "bun:test";
import { isRegularWidth } from "./size-class";

test("an iPad full screen is regular in both orientations, a third of one is compact", () => {
  expect(isRegularWidth(1032, true)).toBe(true);
  expect(isRegularWidth(1376, true)).toBe(true);
  expect(isRegularWidth(375, true)).toBe(false);
});

test("an iPhone is compact except a Plus or Max in landscape", () => {
  expect(isRegularWidth(402, false)).toBe(false);
  expect(isRegularWidth(874, false)).toBe(false);
  expect(isRegularWidth(956, false)).toBe(true);
});
