import { describe, expect, test } from "bun:test";
import type { PluginStatus } from "@telar/engine-client";
import { composerExtensions, NO_EXTENSIONS } from "./composer";

const status = (id: string, state: PluginStatus["state"] = "ready"): PluginStatus => ({
  state,
  meta: {
    id,
    api: 1,
    name: id.toUpperCase(),
    version: "1",
    toolPrefixes: [],
    readTools: [],
    eventKinds: [],
    settings: [],
    composer: {
      decorations: [
        { id: "math", pattern: "\\$[^$]+\\$", style: "math", preview: { renderer: "katex" } },
        { id: "peek", pattern: "#[0-9]+", style: "accent", preview: { verb: "peek" } },
      ],
      commands: [{ name: `${id}-go`, description: "Go", verb: "go" }],
    },
  },
});

const call = async () => "x";

describe("composer extensions from plugin manifests", () => {
  test("only ready plugins the project turned on contribute", () => {
    const extensions = composerExtensions([status("a"), status("b"), status("c", "failed")], ["a", "c"], call);
    expect(extensions.decorations.map((decoration) => decoration.key)).toEqual(["a/math", "a/peek"]);
    expect(extensions.commands.map((command) => [command.plugin, command.name, command.pluginName])).toEqual([["a", "a-go", "A"]]);
    expect(composerExtensions([status("a")], [], call)).toBe(NO_EXTENSIONS);
  });

  test("without a session there is nothing to call: no commands and no route previews, but KaTeX still previews", () => {
    const extensions = composerExtensions([status("a")], ["a"]);
    expect(extensions.commands).toEqual([]);
    expect(extensions.call).toBeUndefined();
    expect(extensions.decorations.map((decoration) => decoration.preview)).toEqual([{ renderer: "katex" }, undefined]);
  });
});
