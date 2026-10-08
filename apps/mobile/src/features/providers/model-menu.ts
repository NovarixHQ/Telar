import type { ProviderDriverKind, ProviderModel, RuntimeMode } from "@telar/engine-client";
import {
  contextWindowOf,
  effortLabel,
  familyOf,
  groupFamilies,
  pickInFamily,
  rowFor,
  rowOf,
  RUNTIME_MODE_LABELS,
  RUNTIME_MODES,
  WINDOW_LABEL,
  windowsOf,
  type ContextWindow,
  type ModelChoice,
} from "@telar/client/providers";

export type MenuOption = { key: string; label: string; subtitle?: string; selected: boolean; choice: ModelChoice };

type MenuSection = { title: string; options: MenuOption[] };

export type ModelMenu = { label: string; window: ContextWindow; families: MenuOption[]; sections: MenuSection[] };

const ULTRACODE = "Extra-high reasoning that can also plan and run multi-step workflows on its own.";

function withDefault(label: string, isDefault: boolean): string {
  return isDefault ? `${label} · Default` : label;
}

/** Moving to another row keeps only the options that row still offers. */
function moving(choice: ModelChoice, row: ProviderModel, driver: ProviderDriverKind): ModelChoice {
  const { effort, fastMode, ultracode, serviceTier } = choice;
  return {
    model: row.id,
    ...(effort && row.efforts.includes(effort as never) ? { effort } : {}),
    ...(fastMode && row.fastMode ? { fastMode } : {}),
    ...(ultracode && offersUltracode(driver, row) ? { ultracode } : {}),
    ...(serviceTier && row.serviceTiers?.some((tier) => tier.id === serviceTier) ? { serviceTier } : {}),
  };
}

function offersUltracode(driver: ProviderDriverKind, row: ProviderModel): boolean {
  return driver === "claude" && row.efforts.includes("xhigh");
}

function levelLabel(choice: ModelChoice, row: ProviderModel | undefined): string | undefined {
  if (choice.effort) return effortLabel(choice.effort);
  if (choice.ultracode) return "Ultracode";
  if (!row || row.efforts.length === 0) return undefined;
  return row.defaultEffort ? effortLabel(row.defaultEffort) : "Auto";
}

/** A provider's families, each a move to its row in the current context window; on another provider that switches the session to it. */
export function providerFamilies(models: readonly ProviderModel[], choice: ModelChoice, window: ContextWindow, driver: ProviderDriverKind, selectedFamily?: string): MenuOption[] {
  const families = groupFamilies(models.filter((model) => !model.hidden)).filter((family) => !family.hidden);
  return families.map((family) => ({ key: family.id, label: family.label, selected: family.id === selectedFamily, choice: moving(choice, pickInFamily(family, window), driver) }));
}

/** The session's model menu as the phone's Swift app draws it: families, then the options the chosen row offers. */
export function modelMenu(models: readonly ProviderModel[], choice: ModelChoice, driver: ProviderDriverKind): ModelMenu {
  const shown = models.filter((model) => !model.hidden);
  const families = groupFamilies(shown).filter((family) => !family.hidden);
  const row = rowOf(shown, choice.model) ?? shown.find((model) => model.isDefault) ?? shown[0];
  const family = familyOf(families, row?.id);
  const window = row ? contextWindowOf(row) : "standard";
  const windows = windowsOf(family);
  const change = (patch: ModelChoice): ModelChoice => ({ ...choice, ...(choice.model || !row ? {} : { model: row.id }), ...patch });

  const sections: MenuSection[] = [];
  if (row && row.efforts.length > 0) {
    sections.push({
      title: "Reasoning",
      options: [
        ...(row.defaultEffort ? [] : [{ key: "auto", label: "Auto", selected: !choice.effort && !choice.ultracode, choice: change({ effort: undefined, ultracode: undefined }) }]),
        ...row.efforts.map((level) => ({
          key: level,
          label: withDefault(effortLabel(level), row.defaultEffort === level),
          selected: !choice.ultracode && (choice.effort ? choice.effort === level : row.defaultEffort === level),
          choice: change({ effort: row.defaultEffort === level ? undefined : level, ultracode: undefined }),
        })),
        ...(offersUltracode(driver, row) ? [{ key: "ultracode", label: "Ultracode", subtitle: ULTRACODE, selected: choice.ultracode === true, choice: change({ ultracode: true, effort: undefined }) }] : []),
      ],
    });
  }
  if (family && windows.length > 1) {
    sections.push({
      title: "Context window",
      options: windows.flatMap((option) => {
        const target = rowFor(family, option);
        return target ? [{ key: option, label: withDefault(WINDOW_LABEL[option], target.defaultWindow === true), selected: option === window, choice: moving(choice, target, driver) }] : [];
      }),
    });
  }
  if (row?.fastMode) {
    sections.push({
      title: "Fast mode",
      options: [
        { key: "on", label: "On", selected: choice.fastMode === true, choice: change({ fastMode: true }) },
        { key: "off", label: "Off · Default", selected: choice.fastMode !== true, choice: change({ fastMode: undefined }) },
      ],
    });
  }
  if (row?.serviceTiers?.length) {
    sections.push({
      title: "Service tier",
      options: [
        ...(row.defaultServiceTier ? [] : [{ key: "auto", label: "Auto", selected: !choice.serviceTier, choice: change({ serviceTier: undefined }) }]),
        ...row.serviceTiers.map((tier) => ({
          key: tier.id,
          label: withDefault(tier.name, row.defaultServiceTier === tier.id),
          ...(tier.description ? { subtitle: tier.description } : {}),
          selected: (choice.serviceTier ?? row.defaultServiceTier) === tier.id,
          choice: change({ serviceTier: row.defaultServiceTier === tier.id ? undefined : tier.id }),
        })),
      ],
    });
  }

  const label = [family?.label ?? "Model", levelLabel(choice, row), windows.length > 1 ? WINDOW_LABEL[window] : undefined, choice.fastMode ? "Fast" : undefined];
  return {
    label: label.filter(Boolean).join(" · "),
    window,
    families: providerFamilies(models, choice, window, driver, family?.id),
    sections,
  };
}

export function accessMenu(mode: RuntimeMode | undefined): { label: string; options: { value: RuntimeMode; label: string; selected: boolean }[] } {
  return {
    label: mode ? RUNTIME_MODE_LABELS[mode] : "Configuration",
    options: RUNTIME_MODES.map((value) => ({ value, label: RUNTIME_MODE_LABELS[value], selected: value === mode })),
  };
}
