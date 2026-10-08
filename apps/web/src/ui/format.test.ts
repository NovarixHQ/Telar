import { describe, expect, test } from "bun:test";
import { plural } from "./format";

describe("plural", () => {
  test("one thing reads singular", () => {
    expect(plural(1, "file")).toBe("1 file");
  });

  test("zero and many read plural", () => {
    expect(plural(0, "file")).toBe("0 files");
    expect(plural(2, "file")).toBe("2 files");
  });

  test("takes an irregular plural and groups thousands", () => {
    expect(plural(1, "has", "have")).toBe("1 has");
    expect(plural(3, "process", "processes")).toBe("3 processes");
    expect(plural(12_345, "file")).toBe("12,345 files");
  });
});
