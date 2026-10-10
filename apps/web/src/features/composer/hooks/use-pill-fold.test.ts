import { describe, expect, test } from "bun:test";
import { MAX_FOLD, nextFold } from "./use-pill-fold";

describe("folding the pills' words", () => {
  test("nothing folds while every label fits", () => {
    expect(nextFold(0, 556, 0, [])).toEqual({ fold: 0 });
  });

  test("a cut label folds one more pill and remembers the width the row needed", () => {
    expect(nextFold(0, 556, 15, [])).toEqual({ fold: 1, need: 571 });
    expect(nextFold(1, 500, 30, [571])).toEqual({ fold: 2, need: 530 });
  });

  test("once every foldable pill is folded, the names truncate rather than fold further", () => {
    expect(nextFold(MAX_FOLD, 300, 80, [571, 530])).toEqual({ fold: MAX_FOLD });
  });

  test("a pill unfolds only when the row is as wide as it was when it folded", () => {
    expect(nextFold(1, 570, 0, [571])).toEqual({ fold: 1 });
    expect(nextFold(1, 571, 0, [571])).toEqual({ fold: 0 });
    expect(nextFold(2, 540, 0, [571, 530])).toEqual({ fold: 1 });
  });
});
