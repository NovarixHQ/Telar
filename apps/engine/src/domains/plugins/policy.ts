import type { PluginMeta } from "@telar/engine-client";

type Ratifiable = { meta: PluginMeta; installed?: unknown };

/** Only a plugin that ships with the app may run tools without asking, and only tools under its own prefixes. */
export function ratifiedReadTools({ meta, installed }: Ratifiable): string[] {
  if (installed) return [];
  return meta.readTools.filter((tool) => meta.toolPrefixes.some((prefix) => tool.startsWith(`${prefix}_`)));
}

export function unratifiedReadClaims(plugin: Ratifiable): string[] {
  const granted = new Set(ratifiedReadTools(plugin));
  return plugin.meta.readTools.filter((tool) => !granted.has(tool));
}

export function ratifiedReadToolSet(plugins: readonly Ratifiable[]): Set<string> {
  return new Set(plugins.flatMap(ratifiedReadTools));
}
