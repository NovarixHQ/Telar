import { expect, test } from "bun:test";
import { parsePatch } from "./patch";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ export function a() {",
  " keep",
  "-old",
  "+new",
  "+added",
  "\\ No newline at end of file",
].join("\n");

test("rows carry old and new line numbers and drop the file headers", () => {
  expect(parsePatch(PATCH)).toEqual([
    { kind: "hunk", text: "@@ -10,3 +10,4 @@ export function a() {" },
    { kind: "ctx", text: "keep", old: 10, new: 10 },
    { kind: "del", text: "old", old: 11 },
    { kind: "add", text: "new", new: 11 },
    { kind: "add", text: "added", new: 12 },
    { kind: "note", text: "No newline at end of file" },
  ]);
});

test("a patch with no hunks has no rows", () => {
  expect(parsePatch("diff --git a/x b/x\nold mode 100644\nnew mode 100755")).toEqual([]);
});
