import { describe, expect, test } from "bun:test";
import { decorationRuns, runAt, type ComposerDecoration } from "./decorations";
import { isLiteral, markdownStyles } from "./markdown";
import { segmentDraft } from "./tokens";

const DISPLAY = String.raw`\$\$[^$\n]+?\$\$`;
const INLINE = String.raw`(?<!\$)\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?![\d$])`;

const decoration = (key: string, source: string, style: ComposerDecoration["style"] = "math"): ComposerDecoration => ({ key, plugin: "test", pattern: new RegExp(source, "u"), style });
const math = [decoration("display", DISPLAY), decoration("inline", INLINE)];

function matched(draft: string, decorations: readonly ComposerDecoration[] = math): string[] {
  const chips = segmentDraft(draft).flatMap((segment) => (segment.type === "chip" ? [{ start: segment.start, end: segment.end }] : []));
  const bits = markdownStyles(draft, chips);
  const inChip = (at: number) => chips.some((chip) => at >= chip.start && at < chip.end);
  return decorationRuns(draft, decorations, (at) => inChip(at) || isLiteral(bits[at]!)).map((run) => draft.slice(run.start, run.end));
}

describe("plugin decorations", () => {
  test("inline and display math match, the display winning its own text", () => {
    expect(matched("so $x^2$ and $$\\int_0^1 f$$ done")).toEqual(["$x^2$", "$$\\int_0^1 f$$"]);
    expect(matched("$a$")).toEqual(["$a$"]);
  });

  test("prices and lone dollars stay plain", () => {
    expect(matched("it costs $5 and $10 today")).toEqual([]);
    expect(matched("pay $ 3 or $")).toEqual([]);
    expect(matched("$x$5")).toEqual([]);
  });

  test("nothing matches inside a code span, a fence or a link", () => {
    expect(matched("run `echo $HOME$` then $y$")).toEqual(["$y$"]);
    expect(matched("```\n$x$\n```\n$z$")).toEqual(["$z$"]);
    expect(matched("[$x$](https://x.dev)")).toEqual([]);
  });

  test("a match may not touch a word character, so snake_case and words stay plain", () => {
    const underline = [decoration("under", "_[a-z]+_", "accent")];
    expect(matched("call snake_case_name now", underline)).toEqual([]);
    expect(matched("an _aside_ here", underline)).toEqual(["_aside_"]);
    expect(matched("cost$x$y")).toEqual([]);
  });

  test("matches stay on one line and the caret finds the run it touches", () => {
    expect(matched("$a\nb$")).toEqual([]);
    const runs = decorationRuns("x $y$ z", math, () => false);
    expect(runAt(runs, 4)?.start).toBe(2);
    expect(runAt(runs, 5)?.end).toBe(5);
    expect(runAt(runs, 0)).toBeUndefined();
  });
});
