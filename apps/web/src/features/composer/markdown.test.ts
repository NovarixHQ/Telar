import { describe, expect, test } from "bun:test";
import { markdownStyles, styleNames } from "./markdown";

/** The draft as runs of equal style, e.g. `["**", "mark"], ["bold", "strong"]`; unstyled runs read "". */
function runs(draft: string, opaque: { start: number; end: number }[] = []): [string, string][] {
  const bits = markdownStyles(draft, opaque);
  const out: [string, string][] = [];
  for (let at = 0; at < draft.length; ) {
    let end = at + 1;
    while (end < draft.length && bits[end] === bits[at]) end += 1;
    out.push([draft.slice(at, end), styleNames(bits[at]!).join(" ")]);
    at = end;
  }
  return out;
}

const styled = (draft: string) => runs(draft).filter(([, style]) => style !== "");

describe("inline", () => {
  test.each([
    ["**bold**", "strong"],
    ["__bold__", "strong"],
    ["*italic*", "em"],
    ["_italic_", "em"],
    ["~~gone~~", "strike"],
  ])("%p styles its text and dims its markers", (draft, style) => {
    const marker = draft.slice(0, draft.indexOf(draft.replace(/^[*_~]+/, "")));
    expect(runs(`say ${draft} now`)).toEqual([
      ["say ", ""],
      [marker, "mark"],
      [draft.slice(marker.length, -marker.length), style],
      [marker, "mark"],
      [" now", ""],
    ]);
  });

  test("bold and italic nest", () => {
    expect(styled("***both***")).toEqual([
      ["**", "mark"],
      ["*", "mark strong"],
      ["both", "strong em"],
      ["*", "mark strong"],
      ["**", "mark"],
    ]);
  });

  test("inline code is never formatted inside", () => {
    expect(runs("run `a **b** c` now")).toEqual([
      ["run ", ""],
      ["`", "mark"],
      ["a **b** c", "code"],
      ["`", "mark"],
      [" now", ""],
    ]);
  });

  test("a link styles its text and dims the target", () => {
    expect(runs("see [docs](https://x.dev) ok")).toEqual([
      ["see ", ""],
      ["[", "mark"],
      ["docs", "link"],
      ["](https://x.dev)", "mark"],
      [" ok", ""],
    ]);
  });

  test("formatting spans a code span", () => {
    expect(styled("**use `x` here**").map(([, style]) => style)).toEqual(["mark", "strong", "mark strong", "strong code", "mark strong", "strong", "mark"]);
  });

  test.each([
    "my_file_name.ts",
    "snake_case_name and other_name",
    "2*3*4",
    "2 * 3 * 4",
    "*.ts and *.js",
    "a ** b ** c",
    "~/notes and ~/code",
    "an * unclosed",
    "``",
    "`unclosed",
  ])("%p stays plain", (draft) => {
    expect(styled(draft)).toEqual([]);
  });
});

describe("blocks", () => {
  test.each([
    ["# Title", "h1"],
    ["## Title", "h2"],
    ["### Title", "h3"],
  ])("%p is a heading with a dimmed marker", (draft, level) => {
    const hashes = draft.indexOf(" ") + 1;
    expect(runs(draft)).toEqual([
      [draft.slice(0, hashes), `mark ${level}`],
      ["Title", level],
    ]);
  });

  test("#123 is not a heading", () => {
    expect(styled("#123 fixed")).toEqual([]);
  });

  test.each(["- milk", "* milk", "+ milk", "1. milk", "- [ ] milk"])("%p dims its list marker", (draft) => {
    const marker = draft.slice(0, draft.indexOf("milk"));
    expect(runs(draft)).toEqual([
      [marker, "mark"],
      ["milk", ""],
    ]);
  });

  test("a list item is formatted inside", () => {
    expect(styled("- **milk**").map(([text]) => text)).toEqual(["- **", "milk", "**"]);
  });

  test("a quote dims its marker", () => {
    expect(runs("> wise words")).toEqual([
      ["> ", "mark"],
      ["wise words", "quote"],
    ]);
  });

  test("a fenced block is code to its closing fence, with no inner formatting", () => {
    expect(runs("```ts\nconst a = **b**;\n```\n**after**")).toEqual([
      ["```ts", "mark codeBlock"],
      ["\n", ""],
      ["const a = **b**;", "codeBlock"],
      ["\n", ""],
      ["```", "mark codeBlock"],
      ["\n", ""],
      ["**", "mark"],
      ["after", "strong"],
      ["**", "mark"],
    ]);
  });

  test("an unclosed fence runs to the end", () => {
    expect(runs("```\n# not a heading")).toEqual([
      ["```", "mark codeBlock"],
      ["\n", ""],
      ["# not a heading", "codeBlock"],
    ]);
  });

  test.each(["---", "***", "- - -"])("%p is a rule", (draft) => {
    expect(runs(draft)).toEqual([[draft, "mark rule"]]);
  });
});

test("opaque ranges are never read as Markdown", () => {
  const draft = "**see `src/a_b.ts` now**";
  const chip = { start: draft.indexOf("`"), end: draft.lastIndexOf("`") + 1 };
  expect(runs(draft, [chip])).toEqual([
    ["**", "mark"],
    ["see ", "strong"],
    ["`src/a_b.ts`", ""],
    [" now", "strong"],
    ["**", "mark"],
  ]);
});

test("a long draft styles in linear time", () => {
  const draft = "- **item** with `code` and _em_ and my_file.ts\n".repeat(4000);
  const started = performance.now();
  markdownStyles(draft);
  expect(performance.now() - started).toBeLessThan(200);
});
