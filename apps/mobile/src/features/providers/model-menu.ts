import type { ModelSelection, ProviderModel, RuntimeMode } from "@telar/engine-client";
import {
  contextWindowOf,
  effortLabel,
  familyOf,
  groupFamilies,
  pickInFamily,
  RUNTIME_MODE_LABELS,
  RUNTIME_MODES,
  visibleModels,
  type ModelChoice,
} from "@telar/client/providers";

export type MenuOption<T> = { value: T; label: string; selected: boolean };

export type ModelMenu = {
  label: string;
  families: MenuOption<string>[];
  efforts: MenuOption<string | undefined>[];
};

/** The session's model choices, grouped into families as the cockpit's menu groups them. */
export function modelMenu(models: readonly ProviderModel[], selection: Pick<ModelSelection, "model" | "effort"> | undefined): ModelMenu {
  const families = groupFamilies(visibleModels(models, selection?.model)).filter((family) => !family.hidden);
  const current = familyOf(families, selection?.model) ?? families.find((family) => family.isDefault);
  const row = current && (current.rows.find((candidate) => candidate.id === selection?.model || candidate.resolves === selection?.model) ?? pickInFamily(current, "standard"));
  const efforts = row?.efforts ?? [];
  const effort = selection?.effort;
  return {
    label: [current?.label ?? "Default", effort ? effortLabel(effort) : undefined].filter(Boolean).join(" · "),
    families: families.map((family) => ({ value: family.id, label: family.label, selected: family === current })),
    efforts: [
      ...(row?.defaultEffort ? [] : [{ value: undefined, label: "Auto", selected: !effort }]),
      ...efforts.map((value) => ({
        value,
        label: value === row?.defaultEffort ? `${effortLabel(value)} · Default` : effortLabel(value),
        selected: effort === value || (!effort && value === row?.defaultEffort),
      })),
    ],
  };
}

/** The choice that picking `familyId` makes: its row in the current context window, keeping an effort the new model still has. */
export function chooseFamily(models: readonly ProviderModel[], selection: ModelChoice | undefined, familyId: string): ModelChoice {
  const families = groupFamilies(models);
  const family = families.find((candidate) => candidate.id === familyId);
  if (!family) return selection ?? {};
  const was = selection?.model ? models.find((model) => model.id === selection.model || model.resolves === selection.model) : undefined;
  const row = pickInFamily(family, was ? contextWindowOf(was) : "standard");
  const effort = selection?.effort && row.efforts.includes(selection.effort as never) ? selection.effort : undefined;
  return { model: row.id, ...(effort ? { effort } : {}) };
}

export function accessMenu(mode: RuntimeMode): { label: string; options: MenuOption<RuntimeMode>[] } {
  return {
    label: RUNTIME_MODE_LABELS[mode],
    options: RUNTIME_MODES.map((value) => ({ value, label: RUNTIME_MODE_LABELS[value], selected: value === mode })),
  };
}
