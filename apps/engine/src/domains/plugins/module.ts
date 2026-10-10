import type { PluginManifest } from "@telar/engine-client";
import type { BundledPlugin, PluginEngine, PluginHost, PluginProject, PluginRoute, PluginSession } from "../../../plugins/sdk";
import type { PluginEngineModule } from "./contract";
import { manifestMeta, TOOL_VERB, zodFrom } from "./manifest";
import { PluginInputError, type PluginMachineRoutes, type PluginProjectRoutes } from "./scoped-routes";

export type ModulePluginDeps = {
  session(sessionId: string): PluginSession;
  project(projectId: string): PluginProject;
  host: Omit<PluginHost, "stateDir">;
};

function missing(manifest: PluginManifest, engine: PluginEngine): string[] {
  const routeKeys = (scope: "project" | "machine") => manifest.routes[scope].filter((key) => !engine[scope]?.[key]).map((key) => `${scope} route "${key}"`);
  return [
    ...manifest.tools.filter((tool) => !engine.tools?.[tool.name]).map((tool) => `tool ${tool.name}`),
    ...manifest.routes.session.filter((verb) => !engine.session?.[verb]).map((verb) => `session verb ${verb}`),
    ...routeKeys("project"),
    ...routeKeys("machine"),
  ];
}

/** A plugin whose engine module runs in-process, reached through the same doors and tables as an installed one. */
export function modulePlugin(plugin: BundledPlugin, manifest: PluginManifest, deps: ModulePluginDeps): PluginEngineModule {
  let engine: PluginEngine | undefined;
  const running = (): PluginEngine => {
    if (!engine) throw new Error(`${manifest.id} is not initialised`);
    return engine;
  };
  const sessionRoutes: NonNullable<PluginEngineModule["routes"]> = {
    [TOOL_VERB]: (input, session) => {
      const name = String(input.name ?? "");
      const tool = manifest.tools.some((declared) => declared.name === name) ? running().tools?.[name] : undefined;
      if (!tool) throw new Error(`${manifest.id} has no tool ${name}`);
      const args = input.arguments && typeof input.arguments === "object" ? (input.arguments as Record<string, unknown>) : {};
      return tool(args, session as PluginSession);
    },
    ...Object.fromEntries(
      manifest.routes.session.map((verb) => [verb, (input: Record<string, unknown>, session: unknown) => running().session![verb]!(input, session as PluginSession)]),
    ),
  };
  const scoped = <Scope, Out>(scope: "project" | "machine", toScope: (scope: Scope) => Out) =>
    Object.fromEntries(
      manifest.routes[scope].map((key) => {
        const route = () => running()[scope]![key] as PluginRoute<Out>;
        return [
          key,
          {
            get status() { return engine?.[scope]?.[key]?.status; },
            get beforeEnable() { return engine?.[scope]?.[key]?.beforeEnable; },
            handle: async (request: Parameters<PluginRoute<Out>["handle"]>[0], given: Scope) => {
              const target = toScope(given);
              try {
                return await route().handle(request, target);
              } catch (error) {
                throw new PluginInputError(error instanceof Error ? error.message : String(error));
              }
            },
          },
        ];
      }),
    );
  const settingsSchema = plugin.settingsSchema ?? zodFrom(manifest.settingsSchema);
  const machineSettingsSchema = plugin.machineSettingsSchema ?? zodFrom(manifest.machineSettingsSchema);
  return {
    meta: manifestMeta(manifest),
    ...(settingsSchema ? { settingsSchema } : {}),
    ...(machineSettingsSchema ? { machineSettingsSchema } : {}),
    ...(manifest.settingsSchema ? { publishedSettingsSchema: manifest.settingsSchema } : {}),
    ...(manifest.machineSettingsSchema ? { publishedMachineSettingsSchema: manifest.machineSettingsSchema } : {}),
    init(context) {
      const created = plugin.engine({ ...deps.host, stateDir: context.stateDir });
      const gaps = missing(manifest, created);
      if (gaps.length > 0) throw new Error(`${manifest.id} declares ${gaps.join(", ")} but its module does not answer it`);
      engine = created;
      context.onDispose(`${manifest.id} module`, () => created.dispose?.());
    },
    hooks: {
      drain: () => undefined,
      busy: () => engine?.busy?.() ?? false,
      releaseSession: (sessionId) => engine?.releaseSession?.(sessionId),
    },
    routes: sessionRoutes,
    projectRoutes: scoped<{ projectId: string }, PluginProject>("project", ({ projectId }) => deps.project(projectId)) as PluginProjectRoutes,
    machineRoutes: scoped<Record<string, never>, Record<string, never>>("machine", (scope) => scope) as PluginMachineRoutes,
    resolve: (sessionId) => deps.session(sessionId),
    assets: (asset) => (plugin.assets && Object.hasOwn(plugin.assets, asset) ? plugin.assets[asset] : undefined),
  };
}
