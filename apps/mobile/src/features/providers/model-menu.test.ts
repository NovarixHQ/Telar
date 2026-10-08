import { expect, test } from "bun:test";
import type { ProviderModel } from "@telar/engine-client";
import { accessMenu, modelMenu, providerFamilies } from "./model-menu";

const model = (id: string, over: Partial<ProviderModel> = {}): ProviderModel => ({
  id,
  label: id,
  isDefault: false,
  hidden: false,
  efforts: ["low", "medium", "high"],
  legacy: false,
  fastMode: false,
  hiddenByUser: false,
  source: "provider",
  ...over,
});

const MODELS = [
  model("opus", { label: "Opus 5.5", isDefault: true, defaultEffort: "high", defaultWindow: true, efforts: ["low", "medium", "high", "xhigh"], fastMode: true }),
  model("opus[1m]", { label: "Opus 5.5 (1M context)", defaultEffort: "high", efforts: ["low", "medium", "high", "xhigh"] }),
  model("haiku", { label: "Haiku 4.5", efforts: [] }),
  model("old", { label: "Old", hidden: true }),
];

const titles = (menu: ReturnType<typeof modelMenu>) => menu.sections.map((section) => section.title);
const picked = (menu: ReturnType<typeof modelMenu>, title: string) => menu.sections.find((section) => section.title === title)?.options.filter((option) => option.selected).map((option) => option.label);

test("the pill names the family, level, window and fast mode", () => {
  expect(modelMenu(MODELS, { model: "opus[1m]", effort: "xhigh" }, "claude").label).toBe("Opus 5.5 · Extra high · 1M");
  expect(modelMenu(MODELS, { fastMode: true }, "claude").label).toBe("Opus 5.5 · High · 200k · Fast");
  expect(modelMenu(MODELS, { model: "haiku" }, "claude").label).toBe("Haiku 4.5");
});

test("the menu lists visible families and the sections the chosen row offers", () => {
  const menu = modelMenu(MODELS, {}, "claude");
  expect(menu.families.map((family) => [family.label, family.selected])).toEqual([
    ["Opus 5.5", true],
    ["Haiku 4.5", false],
  ]);
  expect(titles(menu)).toEqual(["Reasoning", "Context window", "Fast mode"]);
  expect(menu.sections[0]!.options.map((option) => option.label)).toEqual(["Low", "Medium", "High · Default", "Extra high", "Ultracode"]);
  expect(picked(menu, "Reasoning")).toEqual(["High · Default"]);
  expect(picked(menu, "Context window")).toEqual(["200k · Default"]);
  expect(picked(menu, "Fast mode")).toEqual(["Off · Default"]);
  expect(titles(modelMenu(MODELS, { model: "haiku" }, "claude"))).toEqual([]);
});

test("ultracode is Claude's, and choosing it clears the effort", () => {
  const menu = modelMenu(MODELS, { effort: "low" }, "claude");
  expect(menu.sections[0]!.options.find((option) => option.key === "ultracode")?.choice).toEqual({ model: "opus", ultracode: true, effort: undefined });
  expect(modelMenu(MODELS, {}, "codex").sections[0]!.options.some((option) => option.key === "ultracode")).toBe(false);
});

test("the default effort is stored as no effort, and moving family drops what the new row lacks", () => {
  const menu = modelMenu(MODELS, { model: "opus[1m]", effort: "xhigh", fastMode: true }, "claude");
  expect(menu.sections[0]!.options.find((option) => option.key === "high")?.choice).toMatchObject({ effort: undefined });
  expect(menu.families.find((family) => family.label === "Haiku 4.5")?.choice).toEqual({ model: "haiku" });
  expect(menu.sections.find((section) => section.title === "Context window")?.options[0]?.choice).toEqual({ model: "opus", effort: "xhigh", fastMode: true });
  expect(modelMenu(MODELS, { model: "opus", fastMode: true }, "claude").sections.find((section) => section.title === "Context window")?.options[1]?.choice).toEqual({ model: "opus[1m]" });
});

test("service tiers offer Auto unless the row has a default", () => {
  const tiers = [{ id: "flex", name: "Flex" }, { id: "priority", name: "Priority", description: "Faster" }];
  const menu = modelMenu([model("gpt", { isDefault: true, efforts: [], serviceTiers: tiers })], { serviceTier: "priority" }, "codex");
  expect(menu.sections.map((section) => [section.title, section.options.map((option) => option.label)])).toEqual([["Service tier", ["Auto", "Flex", "Priority"]]]);
  expect(picked(menu, "Service tier")).toEqual(["Priority"]);
  expect(menu.sections[0]!.options[2]!.subtitle).toBe("Faster");
});

test("access modes read as the Swift app names them", () => {
  const menu = accessMenu("auto");
  expect(menu.label).toBe("Auto");
  expect(menu.options.map((option) => `${option.label}${option.selected ? " ✓" : ""}`)).toEqual(["Supervised", "Auto-accept edits", "Auto ✓", "Full access"]);
  expect(accessMenu(undefined).label).toBe("Configuration");
});

test("another provider's families move to its row and keep only what it offers", () => {
  const codex = [model("gpt-5", { label: "GPT-5", isDefault: true, efforts: ["low", "high"] }), model("gpt-old", { label: "Old", hidden: true })];
  const options = providerFamilies(codex, { model: "opus", effort: "xhigh", fastMode: true, ultracode: true }, "standard", "codex");
  expect(options.map((option) => [option.label, option.selected])).toEqual([["GPT-5", false]]);
  expect(options[0]!.choice).toEqual({ model: "gpt-5" });
  expect(providerFamilies(codex, { effort: "high" }, "standard", "codex", "gpt-5")[0]).toMatchObject({ selected: true, choice: { model: "gpt-5", effort: "high" } });
});
