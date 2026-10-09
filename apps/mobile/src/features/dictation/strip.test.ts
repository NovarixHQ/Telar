import { expect, test } from "bun:test";
import { appendSpoken, EMPTY_STRIP, insertSpoken, flush, hear, type Strip, type Words } from "./strip";

const play = (results: Words[], from: Strip = EMPTY_STRIP) => {
  let strip = from;
  const written: string[] = [];
  const shown: string[] = [];
  for (const words of results) {
    const step = hear(strip, words);
    strip = step.strip;
    if (step.commit) written.push(step.commit);
    shown.push(strip.heard);
  }
  return { strip, written, shown };
};

test("interim words replace each other in the strip and nothing reaches the draft until the phrase is final", () => {
  const run = play([
    { text: "open", final: false },
    { text: "open the", final: false },
    { text: "open the diff", final: true },
  ]);
  expect(run.shown).toEqual(["open", "open the", ""]);
  expect(run.written).toEqual(["open the diff"]);
});

test("each final phrase is written once, in order", () => {
  const run = play([
    { text: "first part", final: true },
    { text: "second", final: false },
    { text: "second part", final: true },
  ]);
  expect(run.written).toEqual(["first part", "second part"]);
  expect(run.strip).toEqual(EMPTY_STRIP);
});

test("flushing writes the interim words, and the rest of that phrase skips them", () => {
  const before = play([{ text: "run the", final: false }]);
  const flushed = flush(before.strip);
  expect(flushed.commit).toBe("run the");
  const after = play([{ text: "run the tests", final: false }, { text: "run the tests now", final: true }], flushed.strip);
  expect(after.shown).toEqual(["tests", ""]);
  expect(after.written).toEqual(["tests now"]);
});

test("flushing an empty strip writes nothing", () => {
  expect(flush(EMPTY_STRIP)).toEqual({ strip: EMPTY_STRIP, commit: "" });
});

test("spoken words join the draft with one space", () => {
  expect(appendSpoken("", "hello")).toBe("hello");
  expect(appendSpoken("say", "hello")).toBe("say hello");
  expect(appendSpoken("say ", "hello")).toBe("say hello");
  expect(appendSpoken("say", "")).toBe("say");
});

test("spoken words land at the caret, spaced from the words on either side", () => {
  expect(insertSpoken("open diff", 5, "the")).toEqual({ text: "open the diff", caret: 9 });
  expect(insertSpoken("opendiff", 4, "the")).toEqual({ text: "open the diff", caret: 9 });
  expect(insertSpoken("open", 4, "the diff")).toEqual({ text: "open the diff", caret: 13 });
  expect(insertSpoken("diff", 0, "open the")).toEqual({ text: "open the diff", caret: 9 });
  expect(insertSpoken("", 0, "hello")).toEqual({ text: "hello", caret: 5 });
  expect(insertSpoken("open", 99, "it")).toEqual({ text: "open it", caret: 7 });
  expect(insertSpoken("open", 2, "")).toEqual({ text: "open", caret: 2 });
});
