import { expect, test } from "bun:test";
import { skillReference } from "@telar/client/composer";
import { markdownBlocks } from "./markdown-blocks";
import { maskReferences, splitReferences } from "./pills";

const labelsOf = (text: string) => {
  const { masked, references } = maskReferences(text);
  return splitReferences(masked, references).map((part) => (typeof part === "string" ? part : `[${part.label}]`)).join("");
};

test("a skill and a file reference become pills in a message that is also Markdown", () => {
  const text = `**Run** ${skillReference({ name: "deploy" }).text} on \`src/app.ts\` now`;
  const { masked, references } = maskReferences(text);
  expect(references.map((reference) => reference.label)).toEqual(["deploy", "app.ts"]);
  expect(masked).not.toContain("skill");
  const [paragraph] = markdownBlocks(masked);
  expect((paragraph as { tokens?: { type: string }[] } | undefined)?.tokens?.some((token) => token.type === "strong")).toBe(true);
  expect(labelsOf(text)).toBe("**Run** [deploy] on [app.ts] now");
});

test("code fences and bare links are left as written", () => {
  const text = "```sh\ncat `src/app.ts`\n```\nsee https://example.com/a";
  expect(maskReferences(text)).toEqual({ masked: text, references: [] });
});
