import { expect, test } from "bun:test";
import type { GitFileChange, SessionDiff } from "@telar/engine-client";
import { click, flush, installTestDom, mount } from "@/test/dom";
import { DiffSurface } from "./diff-surface";

installTestDom();

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;

const files: GitFileChange[] = [
  { path: "src/a.ts", status: "modified", linesAdded: 1, linesRemoved: 1 },
  { path: "src/b.ts", status: "added", linesAdded: 1, linesRemoved: 0 },
];
const diff: SessionDiff = { repository: true, workspacePath: "/repo", files, commits: [], linesAdded: 2, linesRemoved: 1, truncated: false };

function stubEngine() {
  const patches: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/diff")) {
      const path = url.searchParams.get("path");
      if (!path) return Response.json({ diff });
      patches.push(path);
      return Response.json({ file: { patch: PATCH, binary: false } });
    }
    return Response.json({});
  }) as typeof fetch;
  return patches;
}

async function surface(onOpenFile?: (path: string) => void) {
  const patches = stubEngine();
  const { host } = await mount(
    <DiffSurface projectId="p1" reported={new Map()} suggestion="Work" tab={{ kind: "unstaged" }} {...(onOpenFile ? { onOpenFile } : {})} />,
  );
  await flush(() => host.querySelectorAll(".diff-code-view").length === files.length);
  return { host, patches };
}

const chevron = (host: HTMLElement, path: string) => host.querySelector<HTMLButtonElement>(`[data-diff-path="${path}"] button[aria-expanded]`)!;

test("every file opens expanded, listed once, with no prose under the figures", async () => {
  const { host, patches } = await surface();
  expect(patches.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  expect(chevron(host, "src/a.ts").getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelectorAll(".diff-code-view").length).toBe(2);
  expect(host.querySelectorAll('[role="tree"]').length).toBe(0);
  expect(host.textContent).not.toContain("Everything uncommitted in this project");
  expect(host.textContent).not.toContain("uncommitted work");
});

test("a file's chevron folds just that file, and Collapse all folds the rest", async () => {
  const { host } = await surface();
  await click(chevron(host, "src/a.ts"));
  expect(chevron(host, "src/a.ts").getAttribute("aria-label")).toBe("Expand src/a.ts");
  expect(chevron(host, "src/b.ts").getAttribute("aria-expanded")).toBe("true");

  const collapseAll = [...host.querySelectorAll("button")].find((button) => button.textContent === "Collapse all");
  await click(collapseAll);
  expect(chevron(host, "src/b.ts").getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelectorAll(".diff-code-view").length).toBe(0);
});

test("clicking a file's name opens the file", async () => {
  const opened: string[] = [];
  const { host } = await surface((path) => opened.push(path));
  const name = [...host.querySelectorAll<HTMLButtonElement>('[data-diff-path="src/b.ts"] button')].find((button) => button.title === "src/b.ts");
  await click(name);
  expect(opened).toEqual(["src/b.ts"]);
  expect(chevron(host, "src/b.ts").getAttribute("aria-expanded")).toBe("true");
});
