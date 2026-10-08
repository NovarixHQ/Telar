import { expect, test } from "bun:test";
import { advanceReveal, revealed, revealText, stepReveal } from "./reveal";

test("text already there when the reply opens is shown whole", () => {
  expect(revealText("Hello", revealed(5, 0).shown)).toBe("Hello");
});

test("a chunk is typed out over time and is fully shown within the lag bound", () => {
  let state = revealed(0, 0);
  state = stepReveal(state, "", "x".repeat(120), 0);
  expect(state.shown).toBe(0);
  state = advanceReveal(state, 300);
  expect(state.shown).toBeGreaterThan(0);
  expect(state.shown).toBeLessThan(120);
  expect(advanceReveal(state, 1200).shown).toBe(120);
});

test("steady arrivals keep revealing between polls instead of stalling", () => {
  let state = revealed(0, 0);
  let text = "";
  for (let second = 0; second < 4; second += 1) {
    const next = text + "y".repeat(60);
    state = stepReveal(state, text, next, second * 1000);
    text = next;
  }
  const before = state.shown;
  expect(advanceReveal(state, 3500).shown).toBeGreaterThan(before);
});

test("a rewrite of what was shown resets to the new text whole", () => {
  let state = stepReveal(revealed(0, 0), "", "first draft", 0);
  state = advanceReveal(state, 2000);
  const rewritten = stepReveal(state, "first draft", "second take", 2100);
  expect(rewritten.shown).toBe("second take".length);
});
