import { expect, test } from "bun:test";
import { bands, numberColumn, preparePatch, textPieces } from "./prepare";

const PATCH = ["@@ -1,3 +1,3 @@", " const a = 1;", "-const limit = 400;", "+const limit = 800;", "\\ No newline at end of file"].join("\n");

test("a patch is prepared once and served from the cache after", () => {
  const first = preparePatch("src/a.ts", PATCH);
  expect(preparePatch("src/a.ts", PATCH)).toBe(first);
  expect(preparePatch("src/b.ts", PATCH)).not.toBe(first);
});

test("the code is one run of pieces whose text is the lines joined by newlines", () => {
  const pieces = textPieces(preparePatch("src/a.ts", PATCH));
  expect(pieces.map((piece) => piece.text).join("")).toBe(["@@ -1,3 +1,3 @@", "const a = 1;", "const limit = 400;", "const limit = 800;", "\\ No newline at end of file"].join("\n"));
  expect(pieces[0]).toMatchObject({ tone: "sky" });
  expect(pieces.find((piece) => piece.text.includes("const"))?.tone).toBe("keyword");
  expect(pieces.at(-1)).toMatchObject({ text: "\\ No newline at end of file", tone: "muted" });
});

test("only the changed word carries a mark, by its side", () => {
  const pieces = textPieces(preparePatch("src/a.ts", PATCH));
  expect(pieces.filter((piece) => piece.mark).map((piece) => [piece.text, piece.mark])).toEqual([
    ["400", "del"],
    ["800", "add"],
  ]);
});

test("neighbours that look alike merge, and plain whitespace joins its neighbour but never a mark", () => {
  const plain = { tone: "text", italic: false, bold: false } as const;
  expect(textPieces([{ kind: "ctx", pieces: [{ text: "a", ...plain }, { text: "  ", tone: "base", italic: false, bold: false }, { text: "b", ...plain }] }])).toEqual([{ text: "a  b", ...plain }]);
  expect(textPieces([{ kind: "add", pieces: [{ text: "x", ...plain, mark: "add" }, { text: " ", ...plain }, { text: "y", ...plain }] }])).toEqual([
    { text: "x", ...plain, mark: "add" },
    { text: " y", ...plain },
  ]);
});

test("an empty line still holds a character, so no line of the Text is empty", () => {
  expect(textPieces([{ kind: "ctx", pieces: [] }, { kind: "ctx", pieces: [] }]).map((piece) => piece.text).join("")).toBe(" \n ");
});

test("tints group into positioned bands and the gutter is one column per side", () => {
  const lines = preparePatch("src/a.ts", PATCH);
  expect(bands(lines, (kind) => kind === "add" || kind === "del" || kind === "hunk")).toEqual([
    { kind: "hunk", start: 0, rows: 1 },
    { kind: "del", start: 2, rows: 1 },
    { kind: "add", start: 3, rows: 1 },
  ]);
  expect(numberColumn(lines, "old")).toBe([" ", "1", "2", " ", " "].join("\n"));
  expect(numberColumn(lines, "new")).toBe([" ", "1", " ", "2", " "].join("\n"));
});
