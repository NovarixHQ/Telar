import { expect, test } from "bun:test";
import { buildFileTree, directoryPaths, fileGlyph, fileKind, flattenTree, matchFiles, MAX_SEARCH_MATCHES } from "./tree";

const paths = ["README.md", "src/b.ts", "src/a10.ts", "src/a2.ts", "apps/web/src/page.tsx", "apps/web/next.config.js"];

test("folders come first, names sort naturally, and a lone folder chain reads as one row", () => {
  const tree = buildFileTree(paths);
  expect(tree.map((node) => node.name)).toEqual(["apps/web", "src", "README.md"]);
  expect(tree[1]!.children!.map((node) => node.name)).toEqual(["a2.ts", "a10.ts", "b.ts"]);
  expect(tree[0]!.path).toBe("apps/web");
});

test("only open folders show their children, one level deeper", () => {
  const tree = buildFileTree(paths);
  expect(flattenTree(tree, new Set()).map((row) => row.node.path)).toEqual(["apps/web", "src", "README.md"]);
  const open = flattenTree(tree, new Set(["src"]));
  expect(open.map((row) => [row.node.name, row.depth])).toEqual([["apps/web", 0], ["src", 0], ["a2.ts", 1], ["a10.ts", 1], ["b.ts", 1], ["README.md", 0]]);
  expect(directoryPaths(tree)).toEqual(["apps/web", "apps/web/src", "src"]);
});

test("a search keeps matching paths, case-insensitive, and counts what it drops past the cap", () => {
  expect(matchFiles(paths, "  SRC/A ").matches).toEqual(["src/a10.ts", "src/a2.ts"]);
  const many = Array.from({ length: MAX_SEARCH_MATCHES + 5 }, (_, index) => `f${index}.ts`);
  expect(matchFiles(many, "f")).toMatchObject({ dropped: 5 });
});

test("a file's glyph follows its extension", () => {
  expect(fileGlyph("a/b.tsx")).toBe("chevron.left.forwardslash.chevron.right");
  expect(fileGlyph("notes.md")).toBe("doc.text");
  expect(fileGlyph("Makefile")).toBe("doc");
});

test("a freshly read checkout shows only the root's top level until a folder is opened", () => {
  const rows = flattenTree(buildFileTree(paths), new Set());
  expect(rows.every((row) => row.depth === 0)).toBe(true);
  expect(rows.map((row) => row.node.name)).toEqual(["apps/web", "src", "README.md"]);
});

test("a file opens in the viewer its extension calls for", () => {
  expect(["notes.md", "README.TXT", "docs/guide.rst"].map(fileKind)).toEqual(["prose", "prose", "prose"]);
  expect(["shot.PNG", "a/photo.jpeg", "clip.gif", "pic.heic"].map(fileKind)).toEqual(["image", "image", "image", "image"]);
  expect(fileKind("paper/main.pdf")).toBe("pdf");
  expect(["src/app.ts", "Makefile", "data.csv", "image.svg"].map(fileKind)).toEqual(["code", "code", "code", "code"]);
});
