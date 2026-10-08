import { expect, test } from "bun:test";
import { parsePatch } from "./patch";
import { wordChanges } from "./word-diff";

const marked = (text: string, spans: { start: number; end: number }[]) => spans.map((span) => text.slice(span.start, span.end));

test("a changed word is marked on both sides and the rest stays plain", () => {
  const before = "const limit = 400;";
  const after = "const limit = 800;";
  const spans = wordChanges(before, after)!;
  expect(marked(before, spans.old)).toEqual(["400"]);
  expect(marked(after, spans.new)).toEqual(["800"]);
});

test("adjacent changed tokens merge into one span", () => {
  const spans = wordChanges("return a + b", "return foo(a)")!;
  expect(marked("return foo(a)", spans.new)).toEqual(["foo(", ")"]);
});

test("lines that share too little, or are equal, get no marks", () => {
  expect(wordChanges("alpha beta gamma", "one two three")).toBeUndefined();
  expect(wordChanges("same", "same")).toBeUndefined();
  expect(wordChanges("x".repeat(601), "y")).toBeUndefined();
});

test("a patch pairs removed and added runs line by line", () => {
  const rows = parsePatch(["@@ -1,2 +1,2 @@", "-let a = 1", "-let b = 2", "+let a = 3", "+let b = 2 // two"].join("\n"));
  expect(rows.map((row) => ("changed" in row && row.changed ? marked(row.text, row.changed) : undefined))).toEqual([undefined, ["1"], [], ["3"], [" // two"]]);
});
