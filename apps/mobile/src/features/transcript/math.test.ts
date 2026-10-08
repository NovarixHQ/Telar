import { expect, test } from "bun:test";
import { mathScale, typeset } from "./math";

test("inline maths is typeset whole, spaces and all, as one SVG", () => {
  const set = typeset("R_p/R_\\star \\approx 0.1", false);
  expect(set?.xml.match(/<svg/g)).toHaveLength(1);
  expect(set?.xml).toContain('data-c="2248"');
  expect(set?.xml).toContain('data-c="31"');
  expect(set!.depth).toBeGreaterThan(0);
});

test("blackboard and calligraphic letters render, and bad TeX gives null for a source fallback", () => {
  expect(typeset("\\mathbb{R}^n + \\mathcal{L}", true)).not.toBeNull();
  expect(typeset("\\badcommand{x}", false)).toBeNull();
});

test("maths follows the text around it: 15pt inline, 18pt display, grown with Dynamic Type", () => {
  expect(mathScale(15, false, 1)).toBeCloseTo(15 * 0.442);
  expect(mathScale(15, true, 1)).toBeCloseTo(18 * 0.442);
  expect(mathScale(17, false, 1.5)).toBeCloseTo(17 * 1.5 * 0.442);
});
