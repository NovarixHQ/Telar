import { FlaskConicalIcon, PuzzleIcon, type LucideIcon } from "lucide-react";
import type { CommandId } from "@/features/commands";

export type PluginSurface = { id: string; label: string; icon: LucideIcon; blurb: string; wide?: boolean; key?: string; command?: CommandId };

type PluginWebContribution = {
  surfaces?: readonly PluginSurface[];
};

const PLUGIN_WEB = {
  "data-science": {
    surfaces: [{ id: "data", label: "Data", icon: FlaskConicalIcon, blurb: "Plots, variables and the Python environment", wide: true, key: "a", command: "open-data" }],
  },
} as const satisfies Record<string, PluginWebContribution>;

const PLUGIN_PANELS_SURFACE = {
  id: "plugin-panels",
  label: "Plugins",
  icon: PuzzleIcon,
  blurb: "Panels your plugins draw, such as LaTeX's compile",
  key: "x",
  command: "open-plugin-panels",
} as const satisfies PluginSurface;

export type PluginSurfaceId = (typeof PLUGIN_WEB)[keyof typeof PLUGIN_WEB]["surfaces"][number]["id"] | typeof PLUGIN_PANELS_SURFACE.id;

const REGISTRY: Readonly<Record<string, PluginWebContribution>> = PLUGIN_WEB;

export const PLUGIN_SURFACES: readonly (PluginSurface & { id: PluginSurfaceId })[] = [
  ...Object.values(REGISTRY).flatMap((entry) => (entry.surfaces ?? []) as readonly (PluginSurface & { id: PluginSurfaceId })[]),
  PLUGIN_PANELS_SURFACE,
];

export function pluginSurfaces(enabled: readonly string[], hasPanels = false): (PluginSurface & { id: PluginSurfaceId })[] {
  const on = new Set(enabled);
  return [
    ...Object.entries(REGISTRY).flatMap(([id, entry]) =>
      on.has(id) ? [...((entry.surfaces ?? []) as readonly (PluginSurface & { id: PluginSurfaceId })[])] : [],
    ),
    ...(hasPanels ? [PLUGIN_PANELS_SURFACE] : []),
  ];
}

export function isPluginSurface(id: string): id is PluginSurfaceId {
  return PLUGIN_SURFACES.some((surface) => surface.id === id);
}
