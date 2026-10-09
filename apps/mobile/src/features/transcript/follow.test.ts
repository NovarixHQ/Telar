import { expect, test } from "bun:test";
import { FOLLOWING, markerOnScreen, scrolled, shouldFollow, showsJump } from "./follow";

const at = (offset: number) => ({ offset, viewport: 600, content: 2000 });

test("an untouched transcript follows new content and shows no jump button", () => {
  expect(shouldFollow(FOLLOWING)).toBe(true);
  expect(showsJump(FOLLOWING)).toBe(false);
});

test("a reader who scrolls up stops the follow and gets the jump button", () => {
  const reading = scrolled(FOLLOWING, at(400), true);
  expect(shouldFollow(reading)).toBe(false);
  expect(showsJump(reading)).toBe(true);
});

test("scrolling back to within 40pt of the bottom resumes the follow", () => {
  const reading = scrolled(FOLLOWING, at(400), true);
  const back = scrolled(reading, at(1370), true);
  expect(shouldFollow(back)).toBe(true);
  expect(showsJump(back)).toBe(false);
});

test("content growing under an untouched view does not count as the reader taking it", () => {
  const grown = scrolled(FOLLOWING, at(0), false);
  expect(shouldFollow(grown)).toBe(true);
});

test("the newest answer counts as seen on open when it fits above the composer, with no scroll", () => {
  const atRest = { offset: -100, viewport: 800 };
  expect(markerOnScreen(420, atRest, 120)).toBe(true);
  expect(markerOnScreen(620, atRest, 120)).toBe(false);
});

test("an answer above the viewport or below its covered edge is not seen until scrolled to", () => {
  expect(markerOnScreen(100, { offset: 400, viewport: 800 }, 0)).toBe(false);
  expect(markerOnScreen(1500, { offset: 400, viewport: 800 }, 0)).toBe(false);
  expect(markerOnScreen(1100, { offset: 400, viewport: 800 }, 0)).toBe(true);
});
