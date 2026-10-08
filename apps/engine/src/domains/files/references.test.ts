import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceListing } from "@telar/engine-client";
import { parseFileReference, resolveFileReferences } from "./references";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function checkout(files: string[]): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "telar-references-")));
  roots.push(root);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "x\n");
  }
  return root;
}

const listingOf = (files: string[], truncated = false) => async (): Promise<WorkspaceListing> => ({
  workspacePath: "/unused",
  repository: true,
  files,
  source: "git",
  truncated,
  readAt: 0,
});

test("reads a line off the end of a reference and refuses what cannot be a path", () => {
  expect(parseFileReference("src/a.ts:42")).toEqual({ target: "src/a.ts", line: 42 });
  expect(parseFileReference("src/a.ts:42:7")).toEqual({ target: "src/a.ts", line: 42 });
  expect(parseFileReference("a.ts#L9-L12")).toEqual({ target: "a.ts", line: 9 });
  expect(parseFileReference("./plan.md")).toEqual({ target: "plan.md" });
  expect(parseFileReference("bun test")).toBeUndefined();
  expect(parseFileReference("https://x.dev/a.ts")).toBeUndefined();
  expect(parseFileReference("useState")).toBeUndefined();
});

test("resolves relative, absolute and unique bare names, and leaves the rest out", async () => {
  const files = ["docs/plan.md", "src/app/globals.css", "src/a/index.ts", "src/b/index.ts"];
  const root = checkout(files);
  const answer = await resolveFileReferences(
    root,
    ["docs/plan.md", `${root}/src/app/globals.css:3`, "globals.css", "app/globals.css", "index.ts", "missing.ts", "useState", "/etc/hosts"],
    listingOf(files),
  );
  expect(answer).toEqual([
    { text: "docs/plan.md", path: "docs/plan.md" },
    { text: `${root}/src/app/globals.css:3`, path: "src/app/globals.css", line: 3 },
    { text: "globals.css", path: "src/app/globals.css" },
    { text: "app/globals.css", path: "src/app/globals.css" },
  ]);
});

test("never leaves the checkout, and trusts no bare name from a truncated listing", async () => {
  const root = checkout(["src/schema.ts"]);
  fs.writeFileSync(path.join(path.dirname(root), "outside.md"), "x");
  roots.push(path.join(path.dirname(root), "outside.md"));
  expect(await resolveFileReferences(root, ["../outside.md"], listingOf([]))).toEqual([]);
  expect(await resolveFileReferences(root, ["schema.ts"], listingOf(["src/schema.ts"], true))).toEqual([]);
  expect(await resolveFileReferences(root, ["src/schema.ts"], listingOf([], true))).toEqual([{ text: "src/schema.ts", path: "src/schema.ts" }]);
});
