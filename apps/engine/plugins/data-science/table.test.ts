import { expect, test } from "bun:test";
import { parseDelimited, windowCsv } from "./table";

test("the CSV parser handles quotes, embedded newlines, and windows a sorted view", () => {
  const rows = parseDelimited('a,b\n1,"x, y"\n2,"line\nbreak"\n3,""\n', ",");
  expect(rows).toEqual([["a", "b"], ["1", "x, y"], ["2", "line\nbreak"], ["3", ""]]);
  const window = windowCsv("n,s\n3,c\n1,a\n2,b\n", ",", { offset: 0, limit: 2, sort: "n" });
  expect(window.dtypes).toEqual(["number", "string"]);
  expect(window.total).toBe(3);
  expect(window.rows).toEqual([[1, "a"], [2, "b"]]);
  const desc = windowCsv("n,s\n3,c\n1,a\n2,b\n", ",", { offset: 1, limit: 5, sort: "n", desc: true });
  expect(desc.rows).toEqual([[2, "b"], [1, "a"]]);
});
