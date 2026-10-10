import { expect, test } from "bun:test";
import { act } from "react";
import { click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
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

async function mountTree() {
  stubFetch({ "GET /api/sessions/s1/files": () => ({ listing: LISTING }), "GET /api/sessions/s1/diff": () => ({ diff: { files: [] } }) });
  const opened: string[] = [];
  const { host } = await mount(<FilesSurface sessionId="s1" onOpenFile={(path) => opened.push(path)} />);
  await flush(() => Boolean(host.querySelector('[role="treeitem"]')));
  const rows = () => [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const row = (name: string) => rows().find((node) => node.textContent?.startsWith(name))!;
  return { host, opened, rows, row };
}

test("a checked-out submodule is a folder that expands to its files", async () => {
  const { opened, rows, row } = await mountTree();
  const sub = row("libs/ai");
  expect(sub.getAttribute("aria-expanded")).toBe("false");
  expect(sub.title).toBe("libs/ai (submodule)");
  await click(sub);
  expect(opened).toEqual([]);
  expect(rows().map((node) => node.textContent)).toEqual(["docsnot checked out", "libs/ai", "model.py", "README.md", ".gitmodules", "main.ts"]);
  await click(row("model.py"));
  expect(opened).toEqual(["libs/ai/model.py"]);
});

test("a submodule that is not checked out is an empty folder, not a file", async () => {
  const { opened, row } = await mountTree();
  const docs = row("docs");
  expect(docs.getAttribute("aria-expanded")).toBe("false");
  await click(docs);
  expect(docs.getAttribute("aria-expanded")).toBe("true");
  expect(opened).toEqual([]);
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
