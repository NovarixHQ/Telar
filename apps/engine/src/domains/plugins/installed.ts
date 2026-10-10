import { registerPluginToolPrefixes } from "@telar/engine-client";
import { bundledModulePrefixes, pluginToolModules, setPluginToolModules } from "./bundled";
import type { LoadedExternalPlugin, RefusedExternalPlugin } from "./external/manifest";
import { manifestToolModule } from "./manifest";
import type { PluginToolModule } from "./tool-module";

export type InstalledPlugins = ReturnType<typeof installedPlugins>;

const INSTALLED_TOOL_MODULES = new WeakSet<PluginToolModule>();

export function installedToolModule(loaded: LoadedExternalPlugin): PluginToolModule {
  const module = manifestToolModule(loaded.manifest);
  INSTALLED_TOOL_MODULES.add(module);
  return module;
}

/**
 * What is installed now: loaded plugins by id, and refused folders by listed id. Settings changes both.
 * `sync` re-registers their tool walls beside this process's own; the out-of-process worker loads the folder itself.
 */
export function installedPlugins(external: { loaded: LoadedExternalPlugin[]; refused: RefusedExternalPlugin[] }) {
  const loaded = new Map(external.loaded.map((plugin) => [plugin.manifest.id, plugin]));
  const refused = new Map(external.refused.map((plugin) => [plugin.meta.id, plugin.dir]));
  const baseToolModules = pluginToolModules().filter((module) => !INSTALLED_TOOL_MODULES.has(module));
  const prefixes = () => [...loaded.values()].flatMap((plugin) => (plugin.manifest.toolPrefix ? [plugin.manifest.toolPrefix] : []));
  const sync = () => {
    registerPluginToolPrefixes([...bundledModulePrefixes(), ...prefixes()]);
    setPluginToolModules([...baseToolModules, ...[...loaded.values()].map(installedToolModule)]);
  };
  sync();
  return { loaded, refused, prefixes, sync };
}
