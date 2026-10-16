import { expect, test } from "bun:test";
import type { DelegationMode, ProviderModel } from "@telar/engine-client";
import { delegatedChoice } from "./delegation";

const row = (id: string, extra: Partial<ProviderModel> = {}): ProviderModel => ({
  id,
  label: id,
  isDefault: false,
  hidden: false,
  hiddenByUser: false,
  legacy: false,
  source: "provider",
  efforts: ["low", "medium", "high", "xhigh", "max"],
  fastMode: false,
  ...extra,
});

const CLAUDE = [
  row("claude-fable-5-1[1m]", { isDefault: true, defaultWindow: true }),
  row("claude-opus-5-5[1m]", { defaultWindow: true }),
  row("claude-opus-5-5"),
  row("claude-sonnet-5-5", { defaultWindow: true }),
  row("claude-sonnet-5-5[1m]"),
  row("claude-haiku-4-5", { efforts: [] }),
];
const CODEX = [
  row("gpt-6.1-sol", { isDefault: true, defaultEffort: "low" }),
  row("gpt-6-astra", { defaultEffort: "low" }),
  row("gpt-6-luna", { defaultEffort: "medium" }),
];
const CURSOR = [row("default[]", { efforts: [] }), row("claude-opus-5-5[context=300k]", { efforts: [] }), row("gpt-5.5[context=272k]", { efforts: [] })];

const pick = (mode: DelegationMode, driver: string, rows: ProviderModel[] | undefined, choice: { model?: string; effort?: string } = {}, personSaid?: string) =>
  delegatedChoice({ mode, driver, rows, choice, ...(personSaid ? { personSaid } : {}) });

test("with no model named, Conservative and Normal run the provider's best tier-2 model at medium", () => {
  for (const mode of ["conservative", "normal"] as const) {
    expect(pick(mode, "claude", CLAUDE)).toEqual({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(pick(mode, "codex", CODEX)).toEqual({ model: "gpt-6.1-sol" });
    expect(pick(mode, "cursor", CURSOR)).toEqual({ model: "gpt-5.5[context=272k]" });
  }
});

test("Aggressive leaves the choice alone, so the person's default applies", () => {
  expect(pick("aggressive", "claude", CLAUDE)).toEqual({});
  expect(pick("aggressive", "claude", CLAUDE, { model: "claude-fable-5-1[1m]", effort: "max" })).toEqual({ model: "claude-fable-5-1[1m]", effort: "max" });
});

test("Conservative caps a named model at tier 2 and its effort at medium, within the same provider", () => {
  expect(pick("conservative", "claude", CLAUDE, { model: "claude-opus-5-5", effort: "high" })).toEqual({ model: "claude-sonnet-5-5", effort: "medium" });
  expect(pick("conservative", "codex", CODEX, { model: "gpt-6-astra", effort: "xhigh" })).toEqual({ model: "gpt-6.1-sol", effort: "medium" });
  expect(pick("conservative", "claude", CLAUDE, { model: "claude-haiku-4-5" })).toEqual({ model: "claude-haiku-4-5" });
  expect(pick("conservative", "codex", CODEX, { model: "gpt-6-luna", effort: "low" })).toEqual({ model: "gpt-6-luna", effort: "low" });
});

test("Normal lets an orchestrator ask for tier 3, never above, and caps effort at high", () => {
  expect(pick("normal", "claude", CLAUDE, { model: "claude-opus-5-5", effort: "max" })).toEqual({ model: "claude-opus-5-5", effort: "high" });
  expect(pick("normal", "claude", CLAUDE, { model: "claude-fable-5-1[1m]" })).toEqual({ model: "claude-opus-5-5[1m]", effort: "high" });
  expect(pick("normal", "codex", CODEX, { model: "gpt-6-astra" })).toEqual({ model: "gpt-6-astra" });
});

test("the person naming the model in their own message lifts the cap", () => {
  expect(pick("conservative", "claude", CLAUDE, { model: "claude-opus-5-5", effort: "high" }, "have a builder do this on Opus")).toEqual({
    model: "claude-opus-5-5",
    effort: "high",
  });
  expect(pick("conservative", "claude", CLAUDE, { model: "claude-opus-5-5" }, "fix the flaky test")).toEqual({ model: "claude-sonnet-5-5", effort: "medium" });
});

test("a model of unknown cost passes uncapped, and one the provider does not offer is left for the offer check to refuse", () => {
  expect(pick("conservative", "cursor", CURSOR, { model: "default[]" })).toEqual({ model: "default[]" });
  expect(pick("conservative", "claude", CLAUDE, { model: "gpt-9" })).toEqual({ model: "gpt-9" });
  expect(pick("conservative", "claude", undefined)).toEqual({});
});
