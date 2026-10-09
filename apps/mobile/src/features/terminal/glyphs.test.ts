import { expect, test } from "bun:test";
import { glyphRuns } from "./glyphs";

test("plain text is one run in the code font", () => {
  expect(glyphRuns("ls -la ❯ 🚀")).toEqual([{ text: "ls -la ❯ 🚀", symbols: false }]);
});

test("powerline separators and Nerd Font icons, in both private-use planes, take the symbols face", () => {
  expect(glyphRuns(" main \u{f0219} ok")).toEqual([
    { text: "", symbols: true },
    { text: " main ", symbols: false },
    { text: "\u{f0219}", symbols: true },
    { text: " ok", symbols: false },
  ]);
});

test("no text, no runs", () => {
  expect(glyphRuns("")).toEqual([]);
});
