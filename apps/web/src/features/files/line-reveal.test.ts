import { expect, test } from "bun:test";
import { lineOffset, revealLine, subscribeRevealedLines, takeRevealedLine } from "./line-reveal";

test("a requested line is handed once to the editor that shows the file", () => {
  let heard = 0;
  const stop = subscribeRevealedLines(() => (heard += 1));
  revealLine("src/a.ts", 42);
  stop();
  expect(heard).toBe(1);
  expect(takeRevealedLine("src/b.ts")).toBeUndefined();
  expect(takeRevealedLine("src/a.ts")).toBe(42);
  expect(takeRevealedLine("src/a.ts")).toBeUndefined();
});

test("a line becomes the offset where it starts, clamped to the text", () => {
  expect(lineOffset("one\ntwo\nthree", 1)).toBe(0);
  expect(lineOffset("one\ntwo\nthree", 3)).toBe(8);
  expect(lineOffset("one\ntwo", 99)).toBe(4);
});
