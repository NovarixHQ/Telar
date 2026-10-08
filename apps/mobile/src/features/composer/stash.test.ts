import { expect, test } from "bun:test";
import { appendPrompt, dropEntry, readStash, stashAgo, stashEntry, stashSummary, takeEntry, type StashEntry, type StashStore } from "./stash";

function memory(): StashStore {
  const values = new Map<string, string>();
  return { get: (key) => values.get(key), set: (patch) => Object.entries(patch).forEach(([key, value]) => values.set(key, value)) };
}

const entry = (id: string, prompt: string, images: StashEntry["images"] = []): StashEntry => ({ id, at: 0, prompt, images });
const image = (name: string, size = 10) => ({ name, type: "image/png", dataUrl: `data:image/png;base64,${"A".repeat(size)}` });

test("stashing puts the newest first and keeps twenty", () => {
  const store = memory();
  for (let index = 0; index < 22; index += 1) stashEntry(store, entry(`e${index}`, `prompt ${index}`));
  const rows = readStash(store);
  expect(rows).toHaveLength(20);
  expect(rows[0]!.id).toBe("e21");
  expect(dropEntry(store, "e21")[0]!.id).toBe("e20");
});

test("an entry too heavy for the stash is refused, and old ones go until the rest fits", () => {
  const store = memory();
  expect(stashEntry(store, entry("huge", "", [image("big", 1_300_000)]))).toEqual([]);
  stashEntry(store, entry("old", "", [image("a", 1_100_000)]));
  stashEntry(store, entry("mid", "", [image("b", 1_100_000)]));
  stashEntry(store, entry("new", "", [image("c", 1_100_000)]));
  stashEntry(store, entry("newest", "", [image("d", 1_100_000)]));
  expect(readStash(store).map((row) => row.id)).toEqual(["newest", "new", "mid"]);
});

test("taking an entry returns what fits and leaves the other images stashed", () => {
  const store = memory();
  stashEntry(store, entry("e", "draft", [image("1"), image("2"), image("3")]));
  expect(takeEntry(store, "e", 2)).toMatchObject({ prompt: "draft", left: 1 });
  expect(readStash(store)).toMatchObject([{ id: "e", prompt: "", images: [{ name: "3" }] }]);
  expect(takeEntry(store, "e", 5)).toMatchObject({ prompt: "", left: 0 });
  expect(readStash(store)).toEqual([]);
});

test("a restored prompt follows the draft after a blank line", () => {
  expect(appendPrompt("", "stashed")).toBe("stashed");
  expect(appendPrompt("mine  \n", "stashed")).toBe("mine\n\nstashed");
  expect(appendPrompt("mine", "")).toBe("mine");
});

test("rows read as their first line, or their images, and how long ago", () => {
  expect(stashSummary(entry("e", "\n  first line\nsecond"))).toBe("first line");
  expect(stashSummary(entry("e", "", [image("1"), image("2")]))).toBe("2 images");
  expect(stashAgo(0, 30_000)).toBe("just now");
  expect(stashAgo(0, 3 * 3_600_000)).toBe("3h ago");
  expect(stashAgo(0, 15 * 86_400_000)).toBe("2w ago");
});
