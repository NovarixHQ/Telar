import { describe, expect, test } from "bun:test";
import { fileReference, sessionReference, skillReference } from "@telar/client/composer";
import { applyEdit, runsOf, showDraft, snapOut, toDraftOffset, toShownOffset } from "./pills";

const SKILL = skillReference({ name: "deploy" }).text;
const FILE = fileReference("src/app.ts").text;

/** The field's own view of a keypress: the shown text before and after it. */
function type(draft: string, edit: (shown: string) => string): string {
  const shown = showDraft(draft);
  return applyEdit(draft, shown, edit(shown.text));
}

describe("a skill or file reference in the field", () => {
  test("shows its name, and the draft keeps the sentence that is sent", () => {
    const draft = `Use ${SKILL} on ${FILE} now`;
    expect(showDraft(draft).text).toBe("Use $deploy on app.ts now");
    expect(type(draft, (shown) => shown)).toBe(draft);
  });

  test("Backspace right after a pill removes all of it", () => {
    expect(type(`go ${SKILL}`, (shown) => shown.slice(0, -1))).toBe("go ");
    expect(type(`go ${FILE} now`, (shown) => shown.replace("app.ts", "app.t"))).toBe("go  now");
  });

  test("Delete right before a pill removes all of it", () => {
    expect(type(`go ${SKILL} now`, (shown) => shown.replace("$deploy", "deploy"))).toBe("go  now");
  });

  test("a selection that covers part of a pill takes the whole pill", () => {
    expect(type(`a ${SKILL} b`, (shown) => shown.replace("$dep", ""))).toBe("a  b");
  });

  test("typing beside a pill adds plain text and keeps it", () => {
    expect(type(`${SKILL}`, (shown) => `${shown} and`)).toBe(`${SKILL} and`);
    expect(type(`${SKILL} z`, (shown) => `x${shown}`)).toBe(`x${SKILL} z`);
  });

  test("typing inside a pill lands after it without breaking it", () => {
    expect(type(`${SKILL}`, (shown) => `${shown.slice(0, 3)}Q${shown.slice(3)}`)).toBe(`${SKILL}Q`);
  });

  test("a pasted reference sentence becomes a pill", () => {
    const pasted = type("", () => SKILL);
    expect(showDraft(pasted).pills).toHaveLength(1);
  });

  test("a message with no reference is untouched text", () => {
    expect(type("hello", (shown) => `${shown}!`)).toBe("hello!");
    expect(showDraft("see https://example.com/a").pills).toEqual([]);
  });
});

describe("offsets and the caret", () => {
  const draft = `go ${SKILL} now`;
  const { pills } = showDraft(draft);

  test("offsets convert both ways around a pill", () => {
    expect(toDraftOffset(pills, 3 + "$deploy".length + 4)).toBe(draft.length);
    expect(toShownOffset(pills, draft.length)).toBe("go $deploy now".length);
    expect(toShownOffset(pills, 3 + SKILL.length)).toBe(3 + "$deploy".length);
  });

  test("the caret never rests inside a pill", () => {
    expect(snapOut(pills, 4)).toBe(3);
    expect(snapOut(pills, 8)).toBe(10);
    expect(snapOut(pills, 3)).toBe(3);
    expect(snapOut(pills, 10)).toBe(10);
  });

  test("a draft with two pills keeps later offsets aligned", () => {
    const two = `${SKILL} ${sessionReference({ id: "session_1", title: "Fix" }).text}!`;
    const shown = showDraft(two);
    expect(shown.text).toBe("$deploy Fix!");
    expect(toDraftOffset(shown.pills, shown.text.length)).toBe(two.length);
  });
});

test("the field draws a pill as its own run between plain text", () => {
  expect(runsOf(showDraft(`go ${SKILL} now`))).toEqual([
    { text: "go ", pill: false },
    { text: "$deploy", pill: true },
    { text: " now", pill: false },
  ]);
  expect(runsOf(showDraft(""))).toEqual([{ text: "", pill: false }]);
});
