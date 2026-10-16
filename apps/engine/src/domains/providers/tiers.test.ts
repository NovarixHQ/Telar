import { expect, test } from "bun:test";
import { tierOf } from "./tiers";

test("Codex models are tiered from the manifest, mini to largest, and an unlisted one is unknown", () => {
  expect(tierOf("codex", "gpt-6-luna")).toBe(1);
  expect(tierOf("codex", "gpt-6.1-sol[1m]")).toBe(2);
  expect(tierOf("codex", "gpt-5.6-terra")).toBe(2);
  expect(tierOf("codex", "gpt-6-astra")).toBe(3);
  expect(tierOf("codex", "gpt-9")).toBeUndefined();
});

test("Claude keeps the manifest's tiers", () => {
  expect(tierOf("claude", "haiku")).toBe(1);
  expect(tierOf("claude", "claude-fable-5-1[1m]")).toBe(4);
});

test("Cursor and OpenCode models are tiered by their family, whatever the vendor prefix or options", () => {
  const cases: [string, string, number][] = [
    ["cursor", "claude-haiku-5-5[thinking=true,context=300k]", 1],
    ["cursor", "gemini-3.8-flash[reasoning_effort=high]", 1],
    ["cursor", "gpt-5.4-mini[reasoning=medium]", 1],
    ["cursor", "claude-sonnet-5-5[context=300k]", 2],
    ["cursor", "gpt-5.5[context=272k,reasoning=medium]", 2],
    ["cursor", "grok-4.7[context=256k]", 2],
    ["cursor", "claude-opus-5-5[context=300k]", 3],
    ["cursor", "claude-fable-5-1[thinking=true]", 4],
    ["opencode", "opencode/gemini-3.1-pro", 2],
    ["opencode", "opencode/gpt-5.1-codex-mini", 1],
    ["opencode", "opencode/gpt-5.1-codex-max", 3],
    ["opencode", "opencode/gpt-5.4-pro", 3],
    ["opencode", "opencode/deepseek-v4-pro", 1],
    ["opencode", "opencode/kimi-k3", 1],
  ];
  expect(cases.map(([driver, id]) => [driver, id, tierOf(driver, id)])).toEqual(cases);
});

test("a model of no known family has no tier", () => {
  expect(tierOf("cursor", "default[]")).toBeUndefined();
  expect(tierOf("cursor", "muse-wonder-1.0[context=300k]")).toBeUndefined();
  expect(tierOf("opencode", "ollama/qwen3-coder")).toBeUndefined();
});
