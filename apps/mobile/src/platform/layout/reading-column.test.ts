import { expect, test } from "bun:test";
import { chatWidthOf, laneMaxWidth } from "./reading-column";

test("the lane is Swift's 680pt measure plus margins by default", () => {
  expect(laneMaxWidth("comfortable", 16, true)).toBe(712);
  expect(laneMaxWidth("comfortable", 0, false)).toBe(680);
});

test("Wide and Full only apply on an iPad at regular width", () => {
  expect(laneMaxWidth("wide", 0, true)).toBe(980);
  expect(laneMaxWidth("full", 16, true)).toBe(Infinity);
  expect(laneMaxWidth("wide", 0, false)).toBe(680);
  expect(laneMaxWidth("full", 16, false)).toBe(712);
});

test("an unknown stored value reads as Comfortable", () => {
  expect(chatWidthOf("wide")).toBe("wide");
  expect(chatWidthOf("huge")).toBe("comfortable");
  expect(chatWidthOf(undefined)).toBe("comfortable");
});
