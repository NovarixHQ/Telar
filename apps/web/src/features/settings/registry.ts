import type { PluginStatus } from "@telar/engine-client";
import { pluginSettingsSearchEntries } from "@/features/plugins";
import { indexSettings, type SettingsPageSpec, type SettingsSearchIndex } from "./search";
import { SECTIONS } from "./settings-sections";
import { GENERATED_PAGES } from "./settings-index.generated";
import { EXPERIMENTS } from "./experiments";

export const SETTINGS_SEARCH_PAGES: readonly SettingsPageSpec[] = SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  icon: section.icon,
  ...(section.keywords ? { keywords: section.keywords } : {}),
  groups: (GENERATED_PAGES.find((page) => page.id === section.id)?.groups ?? []).map((group) =>
    section.id === "general" && group.title === "Experimental"
      ? { ...group, rows: EXPERIMENTS.map((experiment) => ({ title: experiment.label, hint: experiment.hint, keywords: ["experiment", "trial"] })) }
      : group,
  ),
}));

export const SETTINGS_SEARCH_INDEX = indexSettings(SETTINGS_SEARCH_PAGES);

export function settingsSearchIndex(
  plugins: readonly PluginStatus[] | undefined,
  bespoke: (scope: "project" | "machine", pluginId: string) => boolean,
): SettingsSearchIndex {
  if (!plugins?.length) return SETTINGS_SEARCH_INDEX;
  const page = (id: string) => ({ id, label: SECTIONS.find((entry) => entry.id === id)?.label ?? id });
  const generated = pluginSettingsSearchEntries(plugins, { project: page("projects"), machine: page("plugins") }, bespoke);
  return { entries: [...SETTINGS_SEARCH_INDEX.entries, ...generated] };
}
