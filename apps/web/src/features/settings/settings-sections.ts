import { BellIcon, BlocksIcon, FolderKanbanIcon, GitPullRequestIcon, HardDriveIcon, KeyboardIcon, PaletteIcon, PlugIcon, PlugZapIcon, SlidersHorizontalIcon, SmartphoneIcon } from "lucide-react";
import type { PluginStatus } from "@telar/engine-client";
import { type SettingsSearchIndex } from "./search";
import { SETTINGS_SEARCH_INDEX, SETTINGS_SEARCH_PAGES } from "./registry";
import { pluginSettingsSearchEntries } from "@/features/plugins";
import type { SettingsSection } from "./components/settings-shell";

export const SECTIONS: SettingsSection[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon, scope: "browser" },
  { id: "keybindings", label: "Keybindings", icon: KeyboardIcon, scope: "browser" },
  { id: "providers", label: "Providers", icon: PlugIcon, scope: "mac", wide: true },
  { id: "integrations", label: "Integrations", icon: PlugZapIcon },
  { id: "plugins", label: "Plugins", icon: BlocksIcon, scope: "mac", wide: true },
  { id: "projects", label: "Projects", icon: FolderKanbanIcon, scope: "project", wide: true },
  { id: "notifications", label: "Notifications", icon: BellIcon, scope: "mac" },
  { id: "source-control", label: "Source control", icon: GitPullRequestIcon, scope: "mac" },
  { id: "storage", label: "Storage", icon: HardDriveIcon, scope: "mac" },
  { id: "connections", label: "Connections", icon: SmartphoneIcon, scope: "mac" },
];

export const SECTION_IDS = SECTIONS.map((section) => section.id);

export function settingsSearchIndex(
  plugins: readonly PluginStatus[] | undefined,
  bespoke: (scope: "project" | "machine", pluginId: string) => boolean,
): SettingsSearchIndex {
  if (!plugins?.length) return SETTINGS_SEARCH_INDEX;
  const page = (id: string) => ({ id, label: SETTINGS_SEARCH_PAGES.find((entry) => entry.id === id)?.label ?? id });
  const generated = pluginSettingsSearchEntries(plugins, { project: page("projects"), machine: page("plugins") }, bespoke);
  return { entries: [...SETTINGS_SEARCH_INDEX.entries, ...generated] };
}
