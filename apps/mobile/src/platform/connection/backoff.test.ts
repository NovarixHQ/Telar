import { expect, test } from "bun:test";
import { backoffDelay } from "./backoff";

test("the wait is never under a second, and its ceiling doubles from 2 s to 5 min", () => {
  expect(backoffDelay(0, () => 0)).toBe(1_000);
  expect([0, 1, 2, 3].map((attempt) => backoffDelay(attempt, () => 1))).toEqual([2_000, 4_000, 8_000, 16_000]);
  expect(backoffDelay(20, () => 1)).toBe(300_000);
});
