import { expect, test } from "bun:test";
import { fileListing } from "./tree";

const PATHS = ["src/app/a.ts", "src/app/b.ts", "README.md", "docs/guide.md"];
const names = (paths: string[], query = "", closed = new Set<string>()) =>
  fileListing(paths, query, closed, false).rows.map((row) => `${"  ".repeat(row.depth)}${row.node.name}`);

test("folders come first and open, single-child chains collapse", () => {
  expect(names(PATHS)).toEqual(["docs", "  guide.md", "src/app", "  a.ts", "  b.ts", "README.md"]);
});

test("a folder closed by hand hides its files", () => {
  expect(names(PATHS, "", new Set(["src/app"]))).toEqual(["docs", "  guide.md", "src/app", "README.md"]);
});

test("search keeps the matches with their folders open and says how many", () => {
  expect(names(PATHS, "b.ts", new Set(["src/app"]))).toEqual(["src/app", "  b.ts"]);
  expect(fileListing(PATHS, "md", new Set(), false).footer).toBe("2 matches");
  expect(fileListing(PATHS, "", new Set(), true).footer).toBe("4 files (capped)");
});
