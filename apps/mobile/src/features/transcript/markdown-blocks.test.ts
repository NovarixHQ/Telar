import { expect, test } from "bun:test";
import { fencedLanguage, highlightCode, isPlainProse, markdownBlocks } from "./markdown-blocks";

test("a reply splits into the blocks the transcript draws", () => {
  const blocks = markdownBlocks("# Plan\n\nSome **bold** and `code`.\n\n> quoted\n\n- [x] done\n- next\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n\n---");
  expect(blocks.filter((block) => block.type !== "space").map((block) => block.type)).toEqual(["heading", "paragraph", "blockquote", "list", "table", "code", "hr"]);
});

test("a fence's info string picks the highlighter's language, and plain fences stay plain", () => {
  expect(fencedLanguage("ts {1-3}")).toBe("typescript");
  expect(fencedLanguage("zsh")).toBe("bash");
  expect(fencedLanguage("text")).toBeUndefined();
  expect(fencedLanguage("klingon")).toBeUndefined();
  expect(fencedLanguage(undefined)).toBeUndefined();
});

test("highlighted code keeps every character, tagged with its scope", () => {
  const code = 'const a = "<x>" & 1; // done';
  const spans = highlightCode(code, "typescript");
  expect(spans.map((span) => span.text).join("")).toBe(code);
  expect(spans).toContainEqual({ text: "const", scope: "keyword" });
  expect(spans).toContainEqual({ text: '"<x>"', scope: "string" });
  expect(spans).toContainEqual({ text: "// done", scope: "comment" });
});

test("code without a language comes back as one plain run", () => {
  expect(highlightCode("ls -la", undefined)).toEqual([{ text: "ls -la" }]);
});

test("$$ math is a display block on its own lines and inline inside a sentence", () => {
  const blocks = markdownBlocks("Depth:\n\n$$\n\\frac{a}{b}\n$$\n\nso $$E=mc^2$$ holds, but `$$code$$` stays code.\n\n$$x^2$$\n");
  const kinds = blocks.filter((block) => block.type !== "space").map((block) => block.type);
  expect(kinds).toEqual(["paragraph", "mathBlock", "paragraph", "mathBlock"]);
  expect(blocks.find((block) => block.type === "mathBlock")).toMatchObject({ text: "\\frac{a}{b}" });
  const sentence = blocks.filter((block) => block.type === "paragraph")[1] as { tokens: { type: string; text?: string }[] };
  expect(sentence.tokens.map((token) => token.type)).toEqual(["text", "mathInline", "text", "codespan", "text"]);
  expect(sentence.tokens[3]).toMatchObject({ text: "$$code$$" });
});

test("a prompt with no Markdown or maths stays plain prose", () => {
  expect(isPlainProse("Fix the build, then run the tests.\n\nThanks")).toBe(true);
  expect(isPlainProse("cost is 2 * 3 dollars")).toBe(true);
  expect(isPlainProse("Use **bold** here")).toBe(false);
  expect(isPlainProse("- one\n- two")).toBe(false);
  expect(isPlainProse("```ts\nconst a = 1;\n```")).toBe(false);
  expect(isPlainProse("Solve $$x^2 = 4$$")).toBe(false);
});
