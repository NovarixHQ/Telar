import path from "node:path";
import { BUNDLED_PLUGIN_TOOL_PREFIXES, machineAllows, pluginSettings, readProjectPlugins, type PluginManifest } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel/errors";
import type { EngineStore } from "../../state";
import { workspaceRootOf } from "../sessions";
import { builtInPlugins, bundledModulePrefixes, bundledModules } from "./bundled";
import { isSymlink } from "./external/installer";
import { loadInstalledPlugins, type LoadedExternalPlugin } from "./external/manifest";
import { externalPlugin } from "./external/module";
import { PluginHost } from "./host";
import { installedPlugins } from "./installed";
import { modulePlugin } from "./module";
import type { BundledPlugin, PluginProject } from "../../../plugins/sdk";

type Gate = (pluginId: string, sessionId: string) => { projectId: string; sessionId: string };

/** A bundled module's view of the engine: its sessions behind the same gate, its settings, and its journal events. */
function bundledModulePlugin(store: EngineStore, gate: Gate, { plugin, manifest }: { plugin: BundledPlugin; manifest: PluginManifest }) {
  const id = manifest.id;
  const machine = () => pluginSettings(store.toolchains.machine(), id);
  const settingsOf = (projectId: string) => pluginSettings(readProjectPlugins(store.projectRegistry.get(projectId)).plugins, id);
  const project = (projectId: string): PluginProject => {
    const record = store.projectRegistry.get(projectId);
    return { projectId, root: record.root, enabled: store.toolchains.runs(record, id), settings: settingsOf(projectId), machine: machine() };
  };
  const check = (schema: BundledPlugin["settingsSchema"], settings: Record<string, unknown>) => {
    const parsed = schema?.safeParse(settings);
    if (parsed && !parsed.success) throw new EngineStateError("invalid_request", `${id}: ${parsed.error.issues[0]?.message ?? "settings are not valid"}`);
  };
  return modulePlugin(plugin, manifest, {
    session: (sessionId) => {
      const { projectId } = gate(id, sessionId);
      return { sessionId, projectId, cwd: workspaceRootOf(store.records.get(sessionId)), settings: settingsOf(projectId), machine: machine() };
    },
    project,
    host: {
      engineRoot: store.paths.root,
      now: () => Date.now(),
      appendEvent: (sessionId, event) => {
        if (!manifest.eventKinds.includes(event.type)) throw new Error(`${id} did not declare the event ${event.type}`);
        store.kernel.appendEvent(sessionId, event as never);
      },
      machineSettings: machine,
      project,
      writeProjectSettings: (projectId, settings) => {
        check(plugin.settingsSchema, settings);
        store.projectRegistry.update(projectId, { plugins: { [id]: { enabled: project(projectId).enabled || readProjectPlugins(store.projectRegistry.get(projectId)).plugins.entries[id]?.enabled === true, settings } } });
      },
      writeMachineSettings: (settings) => {
        check(plugin.machineSettingsSchema, settings);
        store.toolchains.updateMachine({ [id]: { enabled: machineAllows(store.toolchains.machine(), id), settings } });
      },
    },
  });
}

type EnginePluginOptions = { dir: string; daemonId: string; stateDir: string; withKernels: boolean };

/**
 * The engine's plugin host: the bundled plugins, then whatever is installed under `dir`. Every door and tool wall
 * reaches a plugin through `resolve`, the one gate that refuses a plugin turned off for the Mac or the project.
 */
export function createEnginePlugins(store: EngineStore, { dir, daemonId, stateDir, withKernels }: EnginePluginOptions) {
  const resolve = (pluginId: string, sessionId: string): { projectId: string; sessionId: string } => {
    const session = store.records.get(sessionId);
    if (!session.projectId) throw new EngineStateError("invalid_request", `${pluginId} needs a project`);
    const project = store.projectRegistry.get(session.projectId);
    if (!store.toolchains.runs(project, pluginId)) {
      const why = machineAllows(store.toolchains.machine(), pluginId) ? `${pluginId} is not enabled for this session's project` : `${pluginId} is turned off for this computer`;
      throw new EngineStateError("invalid_request", why);
    }
    return { projectId: project.id, sessionId };
  };
  const bundled = builtInPlugins({
    resolveHello: (sessionId) => resolve("hello", sessionId),
    dataScience: {
      resolve: (sessionId) => store.pluginDoors.dataScience(sessionId),
      settings: store.dataScienceOps,
      // Kernels only on an engine that runs turns; outputs are journaled by the store, the host persists images.
      ...(withKernels
        ? {
            kernelHost: {
              options: {
                engineRoot: store.paths.root,
                sessionDir: (sessionId: string) => path.join(store.paths.sessions, sessionId),
                events: {
                  onState: (sessionId, state, reason) => store.pluginDoors.recordKernelState(sessionId, state, reason),
                  persistImage: (sessionId, input) =>
                    store.attachments.put(sessionId, {
                      name: `${input.producer}.${input.mediaType === "image/svg+xml" ? "svg" : "png"}`,
                      mediaType: input.mediaType,
                      data: input.data,
                      tags: ["plot"],
                      producer: input.producer,
                      ...(input.title ? { title: input.title } : {}),
                    }).id,
                },
              },
              attach: (host) => store.pluginDoors.attachKernels(host),
            },
          }
        : {}),
      projectOf: (sessionId) => {
        try {
          return store.records.get(sessionId).projectId;
        } catch {
          return undefined;
        }
      },
    },
  });
  const moduleFor = (loaded: LoadedExternalPlugin) =>
    externalPlugin(loaded, {
      resolve: (sessionId) => resolve(loaded.manifest.id, sessionId),
      enabledAnywhere: () => store.projectRegistry.list().some((project) => store.toolchains.runs(project, loaded.manifest.id)),
      settings: (projectId) => {
        const machine = pluginSettings(store.toolchains.machine(), loaded.manifest.id);
        if (projectId === undefined) return machine;
        try {
          return { ...machine, ...pluginSettings(readProjectPlugins(store.projectRegistry.get(projectId)).plugins, loaded.manifest.id) };
        } catch {
          return machine;
        }
      },
    });
  const external = loadInstalledPlugins(dir);
  const installed = installedPlugins(external);
  const host = new PluginHost([...bundledModules().map((entry) => bundledModulePlugin(store, resolve, entry)), ...bundled, ...external.loaded.map(moduleFor)], {
    daemonId,
    stateDir,
    declaredPrefixes: [...BUNDLED_PLUGIN_TOOL_PREFIXES, ...bundledModulePrefixes(), ...installed.prefixes()],
    refused: external.refused.map(({ dir: folder, meta, error }) => ({ meta, error, installed: { linked: isSymlink(folder) } })),
    log: (message, detail) => console.warn(`[telar] ${message}${detail ? ` ${JSON.stringify(detail)}` : ""}`),
  });
  store.projectRegistry.attachPluginGitignore((id) => host.ready(id)?.meta.gitignore);
  return { host, installed, moduleFor, dir };
}
