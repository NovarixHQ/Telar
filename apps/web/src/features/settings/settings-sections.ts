import { BellIcon, BlocksIcon, FolderKanbanIcon, GitPullRequestIcon, HardDriveIcon, KeyboardIcon, PaletteIcon, PlugIcon, PlugZapIcon, SlidersHorizontalIcon, SmartphoneIcon } from "lucide-react";
import type { SettingsSection } from "./components/settings-shell";

export const SECTIONS: SettingsSection[] = [
  { id: "general", label: "General", icon: SlidersHorizontalIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon, scope: "browser" },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: KeyboardIcon,
    scope: "browser",
    keywords: ["keyboard shortcuts", "shortcut", "hotkey", "chord", "accelerator", "binding", "cmd", "command key", "keyboard", "command palette", "palette", "cmd k", "go to file", "quick open"],
  },
  {
    id: "providers",
    label: "Providers",
    icon: PlugIcon,
    keywords: ["login", "add a login", "account", "claude", "codex", "api key", "sign in", "auth", "provider"],
  },
  { id: "integrations", label: "Integrations", icon: PlugZapIcon, keywords: ["tool"] },
  {
    id: "plugins",
    label: "Plugins",
    icon: BlocksIcon,
    keywords: ["latex", "data science", "extension", "enable", "tectonic", "tex distribution", "texlive", "default engine", "packages", "default python"],
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderKanbanIcon,
    scope: "project",
    keywords: ["host", "paired", "remote", "other mac", "machine", "computer", "scope", "pick", "select", "all projects", "registry"],
  },
  { id: "notifications", label: "Notifications", icon: BellIcon },
  { id: "source-control", label: "Source control", icon: GitPullRequestIcon },
  { id: "storage", label: "Storage", icon: HardDriveIcon },
  { id: "connections", label: "Connections", icon: SmartphoneIcon },
];

export const SECTION_IDS = SECTIONS.map((section) => section.id);
