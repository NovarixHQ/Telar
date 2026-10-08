import { expect, test } from "bun:test";
import type { SessionDiff } from "@telar/engine-client";
import { diffHeadline, diffWarnings, fileLine } from "./summary";

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

test("a file reads as its status letter, name, folder or rename source, and counts", () => {
  expect(fileLine({ path: "src/app/a.ts", status: "modified", linesAdded: 4, linesRemoved: 1 })).toEqual({ path: "src/app/a.ts", letter: "M", name: "a.ts", detail: "src/app", counts: "+4 −1" });
  expect(fileLine({ path: "b.ts", status: "renamed", renamedFrom: "old/b.ts" })).toMatchObject({ letter: "R", detail: "from old/b.ts", counts: "" });
  expect(fileLine({ path: "logo.png", status: "added", binary: true })).toMatchObject({ letter: "A", counts: "binary" });
});

test("the headline counts files and lines, and warnings say what can't be trusted", () => {
  expect(diffHeadline(diff({ files: [{ path: "a", status: "added" }] }))).toBe("1 file · +12 −3");
  expect(diffWarnings(diff())).toEqual([]);
  expect(diffWarnings(diff({ base: undefined, filesIncomplete: "timeout", truncated: true }))).toHaveLength(3);
});
