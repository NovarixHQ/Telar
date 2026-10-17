import { describe, expect, test } from "bun:test";
import { detectComposerTrigger, replaceTextRange } from "./tokens";
import { browserPageReference, checkReference, directoryReference, fileReference, issueReference, pageReference, projectReference, pullReference, sessionReference, skillReference, taskReference } from "@telar/client/composer";

describe("what the caret is in the middle of", () => {
  test("an at-sign opens the path menu and carries what follows it", () => {
    expect(detectComposerTrigger("look at @src/dri", 16)).toEqual({ kind: "path", query: "src/dri", rangeStart: 8, rangeEnd: 16 });
  });

  test("a bare at-sign is already a trigger, so the menu opens before anything is typed", () => {
    expect(detectComposerTrigger("look at @", 9)).toEqual({ kind: "path", query: "", rangeStart: 8, rangeEnd: 9 });
  });

  test("whitespace ends the token, so a completed mention is no longer live", () => {
    expect(detectComposerTrigger("@src/a.ts and then", 18)).toBeNull();
  });

  test("a slash only triggers at the start of a line", () => {
    expect(detectComposerTrigger("/full", 5)).toEqual({ kind: "command", query: "full", rangeStart: 0, rangeEnd: 5 });
    // A slash mid-sentence is a fraction, date or path separator.
    expect(detectComposerTrigger("9/10 tests pass", 4)).toBeNull();
    expect(detectComposerTrigger("see apps/engine", 15)).toBeNull();
  });

  test("a slash on a later line still triggers, because the line is the unit", () => {
    expect(detectComposerTrigger("first line\n/stop", 16)).toEqual({ kind: "command", query: "stop", rangeStart: 11, rangeEnd: 16 });
  });

  test("the argument after a command is part of the query, so a row can be narrowed", () => {
    expect(detectComposerTrigger("/model op", 9)).toEqual({ kind: "command", query: "model op", rangeStart: 0, rangeEnd: 9 });
  });

  test("a line that merely starts with a slash is still a trigger, and matches nothing", () => {
    expect(detectComposerTrigger("/Users/bixku/notes.md is the file", 32)).toMatchObject({ kind: "command" });
  });

  test("a caret past the end of the text is clamped rather than read out of bounds", () => {
    expect(detectComposerTrigger("@a", 999)).toEqual({ kind: "path", query: "a", rangeStart: 0, rangeEnd: 2 });
  });

  test("a dollar opens the skill menu, at the start of a word and nowhere else", () => {
    expect(detectComposerTrigger("$commit", 7)).toEqual({ kind: "skill", query: "commit", rangeStart: 0, rangeEnd: 7 });
    expect(detectComposerTrigger("now run $rel", 12)).toEqual({ kind: "skill", query: "rel", rangeStart: 8, rangeEnd: 12 });
    expect(detectComposerTrigger("use $", 5)).toEqual({ kind: "skill", query: "", rangeStart: 4, rangeEnd: 5 });
  });

  test("a dollar after a non-space character is somebody's shell, not a trigger", () => {
    expect(detectComposerTrigger("PATH=$HOME", 10)).toBeNull();
    expect(detectComposerTrigger("it costs US$40", 14)).toBeNull();
    expect(detectComposerTrigger("echo x$y", 8)).toBeNull();
  });

  test("a substitution is never a trigger, however far into it the caret is", () => {
    expect(detectComposerTrigger("${TELAR_ROOT", 12)).toBeNull();
    expect(detectComposerTrigger("run ${HOME}/bin", 11)).toBeNull();
    expect(detectComposerTrigger("${", 2)).toBeNull();
  });

  test("whitespace ends a skill token too, so a completed pick is no longer live", () => {
    expect(detectComposerTrigger("$commit-messages and then", 25)).toBeNull();
  });
});

describe("splicing", () => {
  test("a replacement reports where the caret lands, not where it started", () => {
    expect(replaceTextRange("look at @dri", 8, 12, "`src/driver.ts`")).toEqual({ text: "look at `src/driver.ts`", cursor: 23 });
  });

  test("an out-of-range span is clamped instead of producing undefined text", () => {
    expect(replaceTextRange("abc", -5, 99, "z")).toEqual({ text: "z", cursor: 1 });
  });
});

