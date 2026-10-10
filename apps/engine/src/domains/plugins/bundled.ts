import { BUNDLED_PLUGIN_TOOL_PREFIXES, manifestToolPrefixes, PluginManifest } from "@telar/engine-client";
import { dataSciencePlugin } from "../../../plugins/data-science";
import { latexPlugin } from "../../../plugins/latex";
import type { BundledPlugin } from "../../../plugins/sdk";
import { helloPlugin, helloToolModule, type HelloSession } from "./hello";
import type { PluginEngineModule } from "./contract";
import { manifestToolModule } from "./manifest";
import type { PluginToolModule } from "./tool-module";

export type BundledPluginDeps = {
  resolveHello: (sessionId: string) => HelloSession;
};

export const HELLO_GATE = "TELAR_PLUGIN_HELLO";

/** Ship with the app and load before `<TELAR_HOME>/plugins`, on the contract an installed plugin uses. */
const MODULE_PLUGINS: readonly BundledPlugin[] = [latexPlugin, dataSciencePlugin];

export const bundledModules = (): { plugin: BundledPlugin; manifest: PluginManifest }[] =>
  MODULE_PLUGINS.map((plugin) => ({ plugin, manifest: PluginManifest.parse(plugin.manifest) }));

/** A test plugin that predates the manifest contract. */
const BUILT_IN_IDS = ["hello"];

/** What an installed plugin may not take: every bundled id and tool prefix. */
export function bundledReservations(): { ids: ReadonlySet<string>; prefixes: ReadonlySet<string> } {
  const manifests = bundledModules().map(({ manifest }) => manifest);
  return {
    ids: new Set([...BUILT_IN_IDS, ...manifests.map((manifest) => manifest.id)]),
    prefixes: new Set([...BUNDLED_PLUGIN_TOOL_PREFIXES, ...bundledModulePrefixes()]),
  };
}

export const bundledModulePrefixes = (): string[] => bundledModules().flatMap(({ manifest }) => manifestToolPrefixes(manifest));

export function builtInPlugins(deps: BundledPluginDeps, env: NodeJS.ProcessEnv = process.env): PluginEngineModule[] {
  return env[HELLO_GATE] === "1" ? [helloPlugin({ resolve: deps.resolveHello })] : [];
}

export function bundledPluginToolModules(env: NodeJS.ProcessEnv = process.env): PluginToolModule[] {
  const modules: PluginToolModule[] = bundledModules().map(({ manifest }) => manifestToolModule(manifest));
  if (env[HELLO_GATE] === "1") modules.push(helloToolModule);
  return modules;
}

let registered: readonly PluginToolModule[] = bundledPluginToolModules();

export function pluginToolModules(): readonly PluginToolModule[] {
  return registered;
}

export function setPluginToolModules(modules: readonly PluginToolModule[]): void {
  registered = [...modules];
}

export function pluginBriefings(enabled: Iterable<string>): string[] {
  const ids = new Set(enabled);
  return registered.flatMap((module) => (ids.has(module.meta.id) && module.meta.briefing ? [module.meta.briefing] : []));
}
