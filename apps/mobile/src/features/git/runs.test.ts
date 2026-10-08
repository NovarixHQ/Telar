import { expect, test } from "bun:test";
import { highlightLines, languageFor } from "./highlight";
import { parsePatch } from "./patch";
import { lineRuns, rowTokens } from "./runs";

test("the grammar comes from the file name, then the extension", () => {
  expect(languageFor("src/App.tsx")).toBe("typescript");
  expect(languageFor("Dockerfile")).toBe("dockerfile");
  expect(languageFor("Cargo.toml")).toBe("ini");
  expect(languageFor("LICENSE")).toBeUndefined();
});

test("a comment opened on one line keeps its colour on the next", () => {
  const lines = highlightLines(["/* one", "two */ const x = 1;"], "typescript")!;
  expect(lines).toHaveLength(2);
  expect(lines[1]![0]).toEqual({ text: "two */", scopes: ["hljs-comment"] });
  expect(lines[1]!.find((token) => token.text === "const")?.scopes).toEqual(["hljs-keyword"]);
});

test("runs cut at token and word-diff edges and carry the syntax colour", () => {
  const text = "const limit = 800;";
  const tokens = highlightLines([text], "typescript")![0];
  const runs = lineRuns(text, tokens, [{ start: 14, end: 17 }]);
  expect(runs.map((run) => run.text).join("")).toBe(text);
  expect(runs.find((run) => run.text === "const")).toMatchObject({ style: { colour: "keyword" }, marked: false });
  expect(runs.find((run) => run.text === "800")).toMatchObject({ style: { colour: "number" }, marked: true });
});

test("a mark inside a token splits it, and unhighlighted lines are one plain run per span edge", () => {
  expect(lineRuns("abcdef", undefined, [{ start: 2, end: 4 }])).toEqual([
    { text: "ab", marked: false },
    { text: "cd", marked: true },
    { text: "ef", marked: false },
  ]);
  expect(lineRuns("", undefined)).toEqual([]);
});

test("removed rows take the old side's tokens and the rest the new side's", () => {
  const rows = parsePatch(["@@ -1,2 +1,2 @@", " keep", "-let old = 1", "+const fresh = 2"].join("\n"));
  const tokens = rowTokens(rows, (lines) => highlightLines(lines, "typescript"));
  expect(tokens[0]).toBeUndefined();
  expect(tokens[2]?.map((token) => token.text).join("")).toBe("let old = 1");
  expect(tokens[3]?.map((token) => token.text).join("")).toBe("const fresh = 2");
});
