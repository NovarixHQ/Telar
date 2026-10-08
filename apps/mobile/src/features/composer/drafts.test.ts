import { expect, test } from "bun:test";
import { readDraft, writeDraft, type DraftStore } from "./drafts";

function memory(): DraftStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => values.get(key),
    set: (patch) => {
      for (const [key, value] of Object.entries(patch)) {
        values.set(key, value);
      }
    },
  };
}

test("each session keeps its own unsent text", () => {
  const store = memory();
  writeDraft(store, "h1", "s1", "half a thought");
  writeDraft(store, "h1", "s2", "another");
  expect(readDraft(store, "h1", "s1")).toBe("half a thought");
  expect(readDraft(store, "h2", "s1")).toBe("");
});

test("clearing the box clears the saved draft", () => {
  const store = memory();
  writeDraft(store, "h1", "s1", "sent soon");
  writeDraft(store, "h1", "s1", "  ");
  expect(readDraft(store, "h1", "s1")).toBe("");
});
