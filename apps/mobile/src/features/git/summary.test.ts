import { expect, test } from "bun:test";
import type { SessionDiff } from "@telar/engine-client";
import { diffNotes, fileLine, relativeTime, statBlocks } from "./summary";

const diff = (over: Partial<SessionDiff> = {}): SessionDiff => ({
  repository: true,
  workspacePath: "/repo",
  branch: "telar/x",
  base: "origin/main",
  files: [],
  commits: [],
  linesAdded: 12,
  linesRemoved: 3,
  truncated: false,
  ...over,
});

test("a file reads as its status badge, name, folder or rename source, and non-zero counts", () => {
  expect(fileLine({ path: "src/app/a.ts", status: "modified", linesAdded: 4, linesRemoved: 0 })).toEqual({ path: "src/app/a.ts", status: "modified", letter: "M", tone: "amber", name: "a.ts", detail: "src/app", added: 4, binary: false });
  expect(fileLine({ path: "b.ts", status: "renamed", renamedFrom: "old/b.ts" })).toMatchObject({ letter: "R", tone: "sky", detail: "from old/b.ts" });
  expect(fileLine({ path: "logo.png", status: "untracked", binary: true })).toMatchObject({ letter: "U", tone: "emerald", binary: true });
});

test("the stat bar splits five blocks by share, keeping one of each colour that changed", () => {
  expect(statBlocks(0, 0)).toEqual({ added: 0, removed: 0 });
  expect(statBlocks(10, 0)).toEqual({ added: 5, removed: 0 });
  expect(statBlocks(0, 10)).toEqual({ added: 0, removed: 5 });
  expect(statBlocks(31_603, 32_942)).toEqual({ added: 2, removed: 3 });
  expect(statBlocks(1, 1000)).toEqual({ added: 1, removed: 4 });
  expect(statBlocks(1000, 1)).toEqual({ added: 4, removed: 1 });
});

test("notes say what can't be trusted, and a clean diff has none", () => {
  expect(diffNotes(diff())).toEqual([]);
  expect(diffNotes(diff({ truncated: true }))).toEqual(["File list truncated."]);
  expect(diffNotes(diff({ base: undefined, filesIncomplete: "timeout" }))).toEqual([
    "No recorded base — committed work is not included.",
    "Nothing was listed — which is not the same as nothing having changed.",
    "git did not answer in time — this list may be missing files and the counts may be low. Pull to ask again.",
  ]);
});

test("commit times read as iOS's abbreviated relative dates", () => {
  const now = 1_800_000_000_000;
  expect(relativeTime(now - 20_000, now)).toBe("20 sec. ago");
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min. ago");
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 hr. ago");
  expect(relativeTime(now - 86_400_000, now)).toBe("1 day ago");
  expect(relativeTime(now - 9 * 86_400_000, now)).toBe("1 wk. ago");
});
