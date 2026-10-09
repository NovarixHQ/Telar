import { expect, test } from "bun:test";
import { followCaret, scrolled } from "./follow";

test("dictated words appended to the draft move the caret, and with it the scroll, to the new end", () => {
  expect(followCaret("open the", "open the diff", true)).toBe(13);
  expect(followCaret("", "open", true)).toBe(4);
});

test("the field stays where the person scrolled it, and edits that are not appends are left alone", () => {
  expect(followCaret("open the", "open the diff", false)).toBeUndefined();
  expect(followCaret("open the diff", "open the", true)).toBeUndefined();
  expect(followCaret("open the diff", "close the diff now", true)).toBeUndefined();
  expect(followCaret("same", "same", true)).toBeUndefined();
});

test("scrolling up stops following until the field is back at its end; the field scrolling itself as text lands does not", () => {
  const start = { offset: 300, following: true };
  const up = scrolled(start, { offset: 120, height: 150, content: 450 }, 21);
  expect(up.following).toBe(false);
  expect(scrolled(up, { offset: 200, height: 150, content: 450 }, 21).following).toBe(false);
  expect(scrolled(up, { offset: 300, height: 150, content: 450 }, 21).following).toBe(true);
  expect(scrolled(start, { offset: 320, height: 150, content: 520 }, 21).following).toBe(true);
  expect(scrolled(start, { offset: 0, height: 150, content: 100 }, 21).following).toBe(true);
});
