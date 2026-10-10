import type { PluginEngineModule, PluginInitContext } from "../contract";
import { manifestMeta, TOOL_VERB, zodFrom } from "../manifest";
import type { PluginMachineRoutes, PluginProjectRoutes, PluginRouteRequest } from "../scoped-routes";
import { isSymlink } from "./installer";
import type { LoadedExternalPlugin } from "./manifest";
import { ExternalPluginProcess, type ExternalProcessOptions } from "./process";

export type ExternalPluginDeps = {
  resolve: (sessionId: string) => { projectId: string; sessionId: string };
  enabledAnywhere: () => boolean;
  settings: (projectId: string | undefined) => Record<string, unknown>;
  process?: Pick<ExternalProcessOptions, "spawn" | "timers" | "requestTimeoutMs" | "startTimeoutMs">;
};

export function externalPlugin(loaded: LoadedExternalPlugin, deps: ExternalPluginDeps): PluginEngineModule & { process(): ExternalPluginProcess | undefined } {
  const { manifest, dir } = loaded;
  const command = manifest.command;
  if (!command) throw new Error(`${manifest.id} has no command`);
  let child: ExternalPluginProcess | undefined;
  const running = (): ExternalPluginProcess => {
    if (!child) throw new Error(`${manifest.id} is not initialised`);
    return child;
  };
  const route = (scope: "session" | "project" | "machine", verb: string, request: Partial<PluginRouteRequest> & Record<string, unknown>) =>
    running().request("telar/route", {
      scope,
      verb,
      input: request.input ?? {},
      ...(request.query ? { query: Object.fromEntries(request.query) } : {}),
      ...(request.params ? { params: request.params } : {}),
      ...(typeof request.sessionId === "string" ? { sessionId: request.sessionId } : {}),
      ...(typeof request.projectId === "string" ? { projectId: request.projectId } : {}),
      settings: deps.settings(typeof request.projectId === "string" ? request.projectId : undefined),
    });

  const sessionRoutes: NonNullable<PluginEngineModule["routes"]> = {
    [TOOL_VERB]: async (input, capability) => {
      const name = String(input.name ?? "");
      if (!manifest.tools.some((tool) => tool.name === name)) throw new Error(`${manifest.id} has no tool ${name}`);
      const { sessionId, projectId } = capability as { sessionId: string; projectId: string };
      return running().request("tools/call", {
        name,
        arguments: input.arguments ?? {},
        _meta: { telar: { sessionId, projectId, settings: deps.settings(projectId) } },
      });
    },
    ...Object.fromEntries(
      manifest.routes.session.map((verb) => [
        verb,
        (input: Record<string, unknown>, capability: unknown) => route("session", verb, { input, ...(capability as object) }),
      ]),
    ),
  };
  const projectRoutes: PluginProjectRoutes = Object.fromEntries(
    manifest.routes.project.map((key) => [key, { handle: (request, scope) => route("project", key, { ...request, projectId: scope.projectId }) }]),
  );
  const machineRoutes: PluginMachineRoutes = Object.fromEntries(
    manifest.routes.machine.map((key) => [key, { handle: (request) => route("machine", key, request) }]),
  );

  const settingsSchema = zodFrom(manifest.settingsSchema);
  const machineSettingsSchema = zodFrom(manifest.machineSettingsSchema);
  return {
    meta: manifestMeta(manifest),
    ...(settingsSchema ? { settingsSchema } : {}),
    ...(machineSettingsSchema ? { machineSettingsSchema } : {}),
    ...(manifest.settingsSchema ? { publishedSettingsSchema: manifest.settingsSchema } : {}),
    ...(manifest.machineSettingsSchema ? { publishedMachineSettingsSchema: manifest.machineSettingsSchema } : {}),
    installed: { linked: isSymlink(dir) },
    init(context: PluginInitContext) {
      const created = new ExternalPluginProcess({
        id: manifest.id,
        dir,
        command,
        stateDir: context.stateDir,
        ...deps.process,
      });
      child = created;
      context.onDispose(`${manifest.id} process`, () => created.stop());
    },
    hooks: {
      drain: () => undefined,
      busy: () => child?.busy ?? false,
      releaseProject: async () => {
        if (!deps.enabledAnywhere()) await child?.stop();
      },
    },
    routes: sessionRoutes,
    projectRoutes,
    machineRoutes,
    resolve: (sessionId) => deps.resolve(sessionId),
    process: () => child,
  };
}
