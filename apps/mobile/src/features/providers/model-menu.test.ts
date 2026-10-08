import { expect, test } from "bun:test";
import type { ProviderModel } from "@telar/engine-client";
import { accessMenu, chooseFamily, modelMenu } from "./model-menu";

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
  model("opus", { label: "Opus 5.5", isDefault: true, defaultEffort: "high", efforts: ["low", "medium", "high", "xhigh"] }),
  model("opus[1m]", { label: "Opus 5.5 (1M context)", defaultEffort: "high", efforts: ["low", "medium", "high", "xhigh"] }),
  model("haiku", { label: "Haiku 4.5", efforts: [] }),
  model("old", { label: "Old", hidden: true }),
];

test("the menu names the session's family and effort, and lists families without the hidden ones", () => {
  const menu = modelMenu(MODELS, { model: "opus[1m]", effort: "xhigh" });
  expect(menu.label).toBe("Opus 5.5 · Extra high");
  expect(menu.families.map((family) => [family.label, family.selected])).toEqual([
    ["Opus 5.5", true],
    ["Haiku 4.5", false],
  ]);
  expect(menu.efforts.map((effort) => effort.label)).toEqual(["Low", "Medium", "High · Default", "Extra high"]);
  expect(menu.efforts.find((effort) => effort.selected)?.value).toBe("xhigh");
});

test("with nothing chosen the default family and its default effort are marked", () => {
  const menu = modelMenu(MODELS, undefined);
  expect(menu.label).toBe("Opus 5.5");
  expect(menu.efforts.filter((effort) => effort.selected).map((effort) => effort.value)).toEqual(["high"]);
});

test("moving family keeps the context window and drops an effort the new model lacks", () => {
  expect(chooseFamily(MODELS, { model: "haiku" }, "opus")).toEqual({ model: "opus" });
  expect(chooseFamily(MODELS, { model: "opus[1m]", effort: "xhigh" }, "haiku")).toEqual({ model: "haiku" });
});

test("access modes read as the cockpit names them", () => {
  expect(accessMenu("auto").options.map((option) => `${option.label}${option.selected ? " ✓" : ""}`)).toEqual([
    "Supervised",
    "Auto-accept edits",
    "Auto ✓",
    "Full access",
  ]);
});
