import { expect, test } from "bun:test";
import { act } from "react";
import type { WorkspaceEntry } from "@telar/engine-client";
import { click, flush, installTestDom, mount } from "@/test/dom";
import { FilesSurface } from "./files-surface";

installTestDom();

const LISTING = {
  workspacePath: "/w",
  repository: true,
  files: [".gitmodules", "libs/ai/model.py", "libs/ai/README.md", "main.ts"],
  submodules: ["docs", "libs/ai"],
  source: "git",
  truncated: false,
  readAt: 1,
};

const dir = (name: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({ name, path: name, kind: "directory", ...extra });
const file = (path: string, extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({ name: path.split("/").at(-1)!, path, kind: "file", ...extra });

function stubDisk(disk: Record<string, WorkspaceEntry[]>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/engine/v2/sessions/s1/diff") return Response.json({ diff: { files: [] } });
    const level = url.searchParams.get("dir");
    if (level === null) return Response.json({ listing: LISTING });
    asked.push(level);
    return Response.json({ directory: { path: level, entries: disk[level] ?? [], truncated: false } });
  }) as typeof fetch;
  return asked;
}

const ROOT_DISK: Record<string, WorkspaceEntry[]> = {
  "": [
    dir(".git"),
    dir("libs"),
    dir("node_modules", { ignored: true }),
    file(".env"),
    file("debug.log", { ignored: true }),
    file("loop", { kind: "link", symlink: true }),
    file("main.ts"),
  ],
  libs: [{ name: "ai", path: "libs/ai", kind: "directory", submodule: true }],
  "libs/ai": [file("libs/ai/model.py")],
};

async function mountTree(disk = ROOT_DISK) {
  const asked = stubDisk(disk);
  const opened: string[] = [];
  const { host } = await mount(<FilesSurface sessionId="s1" onOpenFile={(path) => opened.push(path)} />);
  await flush(() => Boolean(host.querySelector('[role="treeitem"]')));
  const rows = () => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const row = (name: string) => rows().find((node) => node.textContent === name)!;
  return { host, opened, asked, rows, row };
}

test("the tree is what is on disk, ignored entries dimmed, and only the root is read up front", async () => {
  const { rows, row, asked } = await mountTree();
  expect(rows().map((node) => node.textContent)).toEqual([".git", "libs", "node_modules", ".env", "debug.log", "loop", "main.ts"]);
  expect(row("node_modules").className).toContain("opacity-50");
  expect(row("debug.log").className).toContain("opacity-50");
  expect(row("main.ts").className).not.toContain("opacity-50");
  expect(asked).toEqual([""]);
});

test("expanding a folder reads that one level, and a submodule inside it opens to its files", async () => {
  const { opened, rows, row, asked } = await mountTree();
  await click(row("libs"));
  await flush(() => Boolean(row("ai")));
  expect(asked).toEqual(["", "libs"]);
  expect(row("ai").title).toBe("libs/ai (submodule)");
  await click(row("ai"));
  await flush(() => Boolean(row("model.py")));
  expect(rows().map((node) => node.textContent).slice(0, 4)).toEqual([".git", "libs", "ai", "model.py"]);
  await click(row("model.py"));
  expect(opened).toEqual(["libs/ai/model.py"]);
});

test("a link the engine does not follow is listed but does not open", async () => {
  const { opened, row } = await mountTree();
  expect(row("loop").title).toBe("loop (link not followed)");
  await click(row("loop"));
  expect(opened).toEqual([]);
});

test("refreshing shows a file that appeared on disk", async () => {
  const disk = { ...ROOT_DISK, "": [...ROOT_DISK[""]!] };
  const { host, rows } = await mountTree(disk);
  disk[""].push(file("new-untracked.ts"));
  await click(host.querySelector<HTMLElement>('[aria-label="Refresh the file list"]')!);
  await flush(() => rows().some((node) => node.textContent === "new-untracked.ts"));
  expect(rows().at(-1)?.textContent).toBe("new-untracked.ts");
});

test("searching keeps a matching submodule a folder", async () => {
  const { host, rows } = await mountTree();
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search files"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(search, "model");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  expect(rows().map((node) => [node.textContent, node.getAttribute("aria-expanded")])).toEqual([
    ["libs/ai", "true"],
    ["model.py", null],
  ]);
});
