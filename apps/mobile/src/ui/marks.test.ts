import { describe, expect, test } from "bun:test";
import { hsb, nameHue, nameInitial, telarIconSymbol } from "./marks";

describe("nameHue", () => {
  test("matches the Swift app's FNV-1a hue", () => {
    expect(nameHue("telar")).toBe(65);
    expect(nameHue("Telar Dev")).toBe(314);
    expect(nameHue("ñandú")).toBe(5);
    expect(nameHue("8f14e45f-ceea-467a-9575-c0a1b2c3d4e5")).toBe(299);
  });
});

describe("hsb", () => {
  test("converts like SwiftUI's hue/saturation/brightness", () => {
    expect(hsb(65, 0.45, 0.38)).toBe("#5D6135FF");
    expect(hsb(314, 0.45, 0.38)).toBe("#613557FF");
    expect(hsb(0, 0, 1, 0.25)).toBe("#FFFFFF40");
  });
});

describe("nameInitial", () => {
  test("is the first trimmed character, upper-cased, or ?", () => {
    expect(nameInitial("  telar")).toBe("T");
    expect(nameInitial("ñandú")).toBe("Ñ");
    expect(nameInitial("   ")).toBe("?");
  });
});

test("telarIconSymbol maps known ids and ignores the rest", () => {
  expect(telarIconSymbol("building-2")).toBe("building.2");
  expect(telarIconSymbol("nope")).toBeUndefined();
  expect(telarIconSymbol(undefined)).toBeUndefined();
});
