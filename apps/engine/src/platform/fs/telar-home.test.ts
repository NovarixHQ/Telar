import { expect, test } from "bun:test";
import { telarHome } from "./telar-home";

test("TELAR_HOME wins on every platform", () => {
  expect(telarHome({ TELAR_HOME: " /data/telar " }, "linux", "/home/a")).toBe("/data/telar");
});

test("macOS falls back to Application Support", () => {
  expect(telarHome({}, "darwin", "/Users/a")).toBe("/Users/a/Library/Application Support/Telar");
});

test("Linux falls back to XDG_DATA_HOME, then ~/.local/share", () => {
  expect(telarHome({ XDG_DATA_HOME: "/xdg" }, "linux", "/home/a")).toBe("/xdg/telar");
  expect(telarHome({}, "linux", "/home/a")).toBe("/home/a/.local/share/telar");
});
