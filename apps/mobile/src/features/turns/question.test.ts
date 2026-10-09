import { expect, test } from "bun:test";
import type { UserInputField } from "@telar/engine-client";
import { answers, canAdvance, currentPage, isLast, isPicked, move, questionDraft, setCustom, toggle } from "./question";

const branch: UserInputField = { key: "branch", label: "Which branch?", kind: "choice", header: "Branch", choices: ["main", "dev"], descriptions: { dev: "Nightly work" } };
const checks: UserInputField = { key: "checks", label: "Which checks?", kind: "choice", choices: ["lint", "test", "build"], multiple: true };
const note: UserInputField = { key: "note", label: "Anything else?", kind: "text" };

test("a single choice keeps one pick, and tapping it again clears it", () => {
  let draft = questionDraft([branch])!;
  expect(currentPage(draft)).toMatchObject({ question: "Which branch?", header: "Branch", multiple: false, descriptions: { dev: "Nightly work" } });
  draft = toggle(toggle(draft, "main"), "dev");
  expect([isPicked(draft, "main"), isPicked(draft, "dev")]).toEqual([false, true]);
  expect(answers(draft)).toEqual({ branch: "dev" });
  expect(answers(toggle(draft, "dev"))).toBeUndefined();
});

test("a multi-select answers with every pick in the order the choices are listed", () => {
  const draft = toggle(toggle(questionDraft([checks])!, "build"), "lint");
  expect(answers(draft)).toEqual({ checks: ["lint", "build"] });
});

test("typing Other replaces the picks, and picking again drops the typed text", () => {
  let draft = setCustom(toggle(questionDraft([branch, checks])!, "main"), "  release  ");
  expect(isPicked(draft, "main")).toBe(false);
  draft = move(draft, true);
  draft = setCustom(draft, "e2e");
  expect(answers(draft)).toEqual({ branch: "release", checks: ["e2e"] });
  draft = toggle(draft, "test");
  expect(answers(draft)).toEqual({ branch: "release", checks: ["test"] });
});

test("several questions page in order and submit only once each one is answered", () => {
  let draft = questionDraft([branch, checks, note])!;
  expect(canAdvance(draft)).toBe(false);
  expect(move(draft, true).index).toBe(0);
  draft = move(toggle(draft, "main"), true);
  draft = move(toggle(draft, "test"), true);
  expect(isLast(draft)).toBe(true);
  expect(answers(draft)).toBeUndefined();
  draft = setCustom(draft, "ship it");
  expect(answers(draft)).toEqual({ branch: "main", checks: ["test"], note: "ship it" });
  expect(move(draft, false).index).toBe(1);
});

test("a question with a yes/no or secret field is left for the computer", () => {
  expect(questionDraft([{ key: "ok", label: "Proceed?", kind: "boolean" }])).toBeUndefined();
  expect(questionDraft([])).toBeUndefined();
});
