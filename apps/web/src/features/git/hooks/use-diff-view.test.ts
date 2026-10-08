import { describe, expect, test } from "bun:test";
import { DEFAULT_DIFF_VIEW, parseDiffView } from "./use-diff-view";

describe("the diff view preference", () => {
  test("nothing stored is stacked, unwrapped, whitespace-sensitive, with the tree hidden", () => {
    expect(parseDiffView(null)).toEqual({ layout: "stacked", wrap: false, ignoreWhitespace: false, tree: false });
    expect(DEFAULT_DIFF_VIEW).toEqual(parseDiffView(null));
  });

  test("a stored choice survives, both ways round", () => {
    expect(parseDiffView('{"layout":"split","wrap":true,"ignoreWhitespace":true,"tree":false}')).toEqual({
      layout: "split",
      wrap: true,
      ignoreWhitespace: true,
      tree: false,
    });
    expect(parseDiffView('{"layout":"stacked","wrap":false,"ignoreWhitespace":false,"tree":false}')).toEqual(DEFAULT_DIFF_VIEW);
    expect(parseDiffView('{"tree":true}').tree).toBe(true);
  });

  test("a record written before the tree existed leaves the tree hidden", () => {
    expect(parseDiffView('{"layout":"split","wrap":false,"ignoreWhitespace":false}').tree).toBe(false);
  });

  test("one bad key costs only its own field", () => {
    expect(parseDiffView('{"layout":"diagonal","wrap":true}')).toEqual({ layout: "stacked", wrap: true, ignoreWhitespace: false, tree: false });
    expect(parseDiffView('{"layout":"split","wrap":"yes"}')).toEqual({ layout: "split", wrap: false, ignoreWhitespace: false, tree: false });
  });

  test("a corrupt record is a first run, never a surface that will not paint", () => {
    for (const raw of ["", "not json", "null", "[]", '"split"', "42"]) {
      expect(parseDiffView(raw), `${JSON.stringify(raw)} falls back whole`).toEqual(DEFAULT_DIFF_VIEW);
    }
  });
});
