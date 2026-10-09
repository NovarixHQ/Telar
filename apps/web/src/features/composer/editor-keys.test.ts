import { describe, expect, test } from "bun:test";
import { PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES, continueLine, indentLine, isLargePaste, pastedTextFile } from "./editor-keys";

describe("isLargePaste", () => {
  test("counts bytes, so multi-byte text crosses the threshold with fewer characters", () => {
    expect(isLargePaste("a".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES - 1))).toBe(false);
    expect(isLargePaste("é".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES / 2))).toBe(true);
  });
});

describe("pastedTextFile", () => {
  test("is a text file named apart from the pastes already attached", async () => {
    const file = pastedTextFile("body", ["pasted-text.txt", "Pasted-Text-2.txt"]);
    expect(file.name).toBe("pasted-text-3.txt");
    expect(file.type).toStartWith("text/plain");
    expect(await file.text()).toBe("body");
  });
});

describe("continueLine", () => {
  test("splits an item at the caret, carrying the rest to the new item", () => {
    expect(continueLine("- ab", 3)).toEqual({ text: "- a\n- b", cursor: 6 });
  });

  test("leaves plain text and a caret inside the marker to the browser", () => {
    expect(continueLine("plain", 5)).toBeUndefined();
    expect(continueLine("- a", 1)).toBeUndefined();
  });

  test("leaves an unindented code line to the browser", () => {
    expect(continueLine("```\n- not a list", 16)).toBeUndefined();
  });
});

test("indentLine moves the caret with the item and stops outdenting at the margin", () => {
  expect(indentLine("1. a", 4, false)).toEqual({ text: "  1. a", cursor: 6 });
  expect(indentLine("- a", 3, true)).toEqual({ text: "- a", cursor: 3 });
});
