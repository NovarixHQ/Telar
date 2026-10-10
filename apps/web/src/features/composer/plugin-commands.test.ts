import { describe, expect, test } from "bun:test";
import type { ComposerCommand } from "./decorations";
import { pluginCommandAt, pluginCommandCompletions, writingPluginCommand } from "./plugin-commands";

const tex: ComposerCommand = { plugin: "latex", pluginName: "LaTeX", name: "tex", description: "Write LaTeX from words", verb: "tex", hint: "in words" };

describe("plugin commands in the draft", () => {
  test("words after the command are its input, and its answer replaces that line", () => {
    const draft = "Here is the integral:\n/tex integral of x squared\nthanks";
    expect(pluginCommandAt(draft, draft.indexOf("squared"), [tex])).toEqual({ command: tex, text: "integral of x squared", start: 22, end: 48 });
  });

  test("alone on its line, the rest of the draft is its input and the answer replaces the draft", () => {
    const draft = "a half plus a third\n/tex";
    expect(pluginCommandAt(draft, draft.length, [tex])).toEqual({ command: tex, text: "a half plus a third", start: 0, end: draft.length });
  });

  test("only a declared command at the start of the caret's line counts", () => {
    expect(pluginCommandAt("/tex x", 6, [])).toBeUndefined();
    expect(pluginCommandAt("/compact now", 12, [tex])).toBeUndefined();
    expect(pluginCommandAt("see /tex x", 10, [tex])).toBeUndefined();
    expect(pluginCommandAt("/tex x\nmore", 10, [tex])).toBeUndefined();
  });

  test("past `/name ` the menu stays shut, and Telar's own names are never offered twice", () => {
    expect(writingPluginCommand("tex x squared", [tex])).toBe(true);
    expect(writingPluginCommand("tex", [tex])).toBe(false);
    expect(pluginCommandCompletions([tex, { ...tex, name: "stop" }], new Set(["stop"]))).toEqual([
      { id: "plugin:latex:tex", label: "/tex", detail: "Write LaTeX from words · in words", glyph: "plugin", group: "Plugin commands", action: { type: "insert", text: "/tex" } },
    ]);
  });
});
