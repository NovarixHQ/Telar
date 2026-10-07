import { expect, test } from "bun:test";
import { codexLimitWindows } from "./limits";

test("a paid plan reads as its 5 h and weekly windows, resets in milliseconds", () => {
  const windows = codexLimitWindows({
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 18, windowDurationMins: 10_080 },
    },
  });
  expect(windows).toEqual([
    { key: "primary", label: "5 h", usedPercent: 42, resetsAt: 1_800_000_000_000 },
    { key: "secondary", label: "week", usedPercent: 18 },
  ]);
});

test("without a duration a free plan's primary window is the month", () => {
  expect(codexLimitWindows({ rateLimits: { planType: "free", primary: { usedPercent: 7 } } })).toEqual([{ key: "primary", label: "month", usedPercent: 7 }]);
});

test("another model's limits and a missing snapshot read as no windows", () => {
  expect(codexLimitWindows({ rateLimits: { limitId: "spark", primary: { usedPercent: 90 } } })).toEqual([]);
  expect(codexLimitWindows({})).toEqual([]);
});
