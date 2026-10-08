import { expect, test } from "bun:test";
import { bands, numberColumn, preparePatch, textPieces } from "./prepare";

const PATCH = ["@@ -1,3 +1,3 @@", " const a = 1;", "-const limit = 400;", "+const limit = 800;", "", "\\ No newline at end of file"].join("\n");

test("a patch is prepared once and served from the cache after", () => {
  const first = preparePatch("src/a.ts", PATCH);
  expect(preparePatch("src/a.ts", PATCH)).toBe(first);
  expect(preparePatch("src/b.ts", PATCH)).not.toBe(first);
});

test("the code is one run of pieces whose text is the lines joined by newlines", () => {
  const lines = preparePatch("src/a.ts", PATCH);
  const pieces = textPieces(lines);
  expect(pieces.map((piece) => piece.text).join("")).toBe(["@@ -1,3 +1,3 @@", "const a = 1;", "const limit = 400;", "const limit = 800;", "\\ No newline at end of file"].join("\n"));
  expect(pieces[0]).toMatchObject({ tone: "sky" });
  expect(pieces.find((piece) => piece.text.includes("const"))?.tone).toBe("keyword");
  expect(pieces.at(-1)).toMatchObject({ text: "\\ No newline at end of file", tone: "muted" });
});

test("neighbouring pieces that look alike merge, and whitespace joins its neighbour", () => {
  const pieces = textPieces([{ kind: "ctx", pieces: [{ text: "a", tone: "text", italic: false, bold: false }, { text: "  ", tone: "base", italic: false, bold: false }, { text: "b", tone: "text", italic: false, bold: false }], marks: [] }]);
  expect(pieces).toEqual([{ text: "a  b", tone: "text", italic: false, bold: false }]);
});

test("only changed lines carry marks, and only on the changed word", () => {
  const lines = preparePatch("src/a.ts", PATCH);
  expect(lines[1]!.marks).toEqual([]);
  expect(lines[2]!.marks.filter((mark) => mark.marked).map((mark) => mark.text)).toEqual(["400"]);
  expect(lines[3]!.marks.map((mark) => mark.text).join("")).toBe("const limit = 800;");
});

test("tints group into bands and the gutter is one column per side", () => {
  const lines = preparePatch("src/a.ts", PATCH);
  expect(bands(lines, (kind) => kind === "add" || kind === "del" || kind === "hunk")).toEqual([
    { kind: "hunk", rows: 1 },
    { kind: "ctx", rows: 1 },
    { kind: "del", rows: 1 },
    { kind: "add", rows: 1 },
    { kind: "ctx", rows: 1 },
  ]);
  expect(numberColumn(lines, "old")).toBe([" ", "1", "2", " ", " "].join("\n"));
  expect(numberColumn(lines, "new")).toBe([" ", "1", " ", "2", " "].join("\n"));
});

test("an empty line still holds a character, so no line of the Text is empty", () => {
  const pieces = textPieces([{ kind: "ctx", pieces: [], marks: [] }, { kind: "ctx", pieces: [], marks: [] }]);
  expect(pieces.map((piece) => piece.text).join("")).toBe(" \n ");
});
