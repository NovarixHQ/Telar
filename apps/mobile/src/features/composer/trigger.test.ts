import { expect, test } from "bun:test";
import { detectTrigger, openingCommands, replaceTrigger } from "./trigger";

test("a slash opens commands only at the start of the caret's line", () => {
  expect(detectTrigger("/sup")).toEqual({ kind: "command", query: "sup", start: 0, end: 4 });
  expect(detectTrigger("first line\n/auto")).toEqual({ kind: "command", query: "auto", start: 11, end: 16 });
  expect(detectTrigger("a/b")).toBeUndefined();
});

test("@ and $ words ending at the caret are mentions and skills", () => {
  expect(detectTrigger("look at @Pri")).toEqual({ kind: "mention", query: "Pri", start: 8, end: 12 });
  expect(detectTrigger("use $orch")).toEqual({ kind: "skill", query: "orch", start: 4, end: 9 });
  expect(detectTrigger("echo ${HOME}")).toBeUndefined();
  expect(detectTrigger("@done and more")).toBeUndefined();
  expect(detectTrigger("@done and more", 5)).toMatchObject({ kind: "mention", query: "done" });
});

test("picking replaces only the trigger, and the plus menu opens commands on a line of its own", () => {
  const text = "see @pri now";
  expect(replaceTrigger(text, detectTrigger(text, 8)!, "the session ")).toBe("see the session  now");
  expect(openingCommands("")).toBe("/");
  expect(openingCommands("hello")).toBe("hello\n/");
  expect(openingCommands("hello\n")).toBe("hello\n/");
});
