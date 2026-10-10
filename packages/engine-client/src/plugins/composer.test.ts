import { describe, expect, test } from "bun:test";
import { parseComposerAnswer } from "./composer";
import { PluginManifest } from "./schema";

const base = { id: "notes", api: 1, name: "Notes", version: "1", command: ["./server"], routes: { session: ["expand", "peek"] } };

const issues = (composer: unknown) => PluginManifest.safeParse({ ...base, composer }).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) ?? [];

describe("composer contributions in the manifest", () => {
  test("decorations and commands on declared session routes are accepted, with defaults filled", () => {
    const parsed = PluginManifest.parse({
      ...base,
      composer: {
        decorations: [
          { id: "math", pattern: "\\$[^$\\n]+\\$", style: "math", preview: { renderer: "katex" } },
          { id: "ticket", pattern: "#[0-9]+", style: "accent", preview: { verb: "peek" } },
        ],
        commands: [{ name: "expand", description: "Expand a note", verb: "expand", hint: "a few words" }],
      },
    });
    expect(parsed.composer?.decorations.map((decoration) => decoration.id)).toEqual(["math", "ticket"]);
    expect(PluginManifest.parse({ ...base, composer: { commands: [] } }).composer).toEqual({ decorations: [], commands: [] });
  });

  test("a command or preview on an undeclared route is refused where it is written", () => {
    expect(issues({ commands: [{ name: "x", description: "X", verb: "missing" }] })).toEqual(['composer.commands.0.verb: "missing" is not a declared session route']);
    expect(issues({ decorations: [{ id: "d", pattern: "a+", style: "code", preview: { verb: "gone" } }] })).toEqual([
      'composer.decorations.0.preview.verb: "gone" is not a declared session route',
    ]);
  });

  test("a pattern must compile and must not match empty text", () => {
    expect(issues({ decorations: [{ id: "d", pattern: "(", style: "math" }] })[0]).toContain("not a regular expression");
    expect(issues({ decorations: [{ id: "d", pattern: "a*", style: "math" }] })[0]).toContain("must not match empty text");
  });

  test("styles come from the fixed set and unknown keys are refused", () => {
    expect(issues({ decorations: [{ id: "d", pattern: "a", style: "rainbow" }] })[0]).toContain("decorations.0.style");
    expect(issues({ decorations: [{ id: "d", pattern: "a", style: "math", className: "x" }] })[0]).toContain("className");
    expect(issues({ commands: [{ name: "Tex", description: "X", verb: "expand" }] })[0]).toContain("commands.0.name");
  });

  test("an answer is text under the cap", () => {
    expect(parseComposerAnswer({ text: "$x$" })).toBe("$x$");
    expect(() => parseComposerAnswer({ html: "<b>" })).toThrow("without text");
    expect(() => parseComposerAnswer({ text: "x".repeat(20_001) })).toThrow("too long");
  });
});
