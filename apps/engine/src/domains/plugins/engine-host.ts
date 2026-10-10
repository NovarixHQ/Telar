import path from "node:path";
import { BUNDLED_PLUGIN_TOOL_PREFIXES, machineAllows, pluginSettings, readProjectPlugins, type PluginManifest } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel/errors";
import type { EngineStore } from "../../state";
import { readFenced, writeFenced } from "../files";
import { ensureTelarGitignore } from "../git";
import { oneShotCompleter, type OneShotCompleter } from "../providers";
import { workspaceRootOf } from "../sessions";
import { appendOneShotUsage } from "../usage";
import { builtInPlugins, bundledModulePrefixes, bundledModules } from "./bundled";
import { isSymlink } from "./external/installer";
import { loadInstalledPlugins, type LoadedExternalPlugin } from "./external/manifest";
import { externalPlugin } from "./external/module";
import { PluginHost } from "./host";
import { legacyKernelEvent } from "./legacy-events";
import { createPluginEvents, type PluginEvents } from "./events";
import { installedPlugins } from "./installed";
import { modulePlugin } from "./module";
import type { BundledPlugin, PluginProject } from "../../../plugins/sdk";

type Gate = (pluginId: string, sessionId: string) => { projectId: string; sessionId: string };

/** A bundled module's view of the engine: its sessions behind the same gate, its settings, and its events. */
function bundledModulePlugin(store: EngineStore, gate: Gate, events: PluginEvents, complete: OneShotCompleter, { plugin, manifest }: { plugin: BundledPlugin; manifest: PluginManifest }, withProcesses: boolean) {
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
  const located = (sessionId: string) => {
    const session = store.records.get(sessionId);
    return {
      sessionId,
      projectId: session.projectId ?? "",
      cwd: workspaceRootOf(session),
      ...(session.workspace.mode === "worktree" ? { worktree: path.basename(session.workspace.path) } : {}),
      stateDir: path.join(store.paths.sessions, sessionId, manifest.sessionStateDir ?? id),
    };
  };
  return modulePlugin(plugin, manifest, {
    session: (sessionId) => {
      const { projectId } = gate(id, sessionId);
      return { ...located(sessionId), projectId, settings: settingsOf(projectId), machine: machine() };
    },
    sessionOf: (sessionId) => {
      try {
        const session = located(sessionId);
        return session.projectId ? session : undefined;
      } catch {
        return undefined;
      }
    },
    project,
    withProcesses,
    host: {
      engineRoot: store.paths.root,
      now: () => Date.now(),
      emit: (event) => void events.emit(id, manifest.eventKinds, event),
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
      complete: (request) => complete(`plugin:${id}`, request),
      attachments: {
        put: (sessionId, input) => store.attachments.put(sessionId, input),
        bytes: (sessionId, attachmentId) => store.attachments.bytes(sessionId, attachmentId).data,
      },
      files: {
        read: (root, target, maxBytes) => readFenced(root, target, "session workspace", maxBytes),
        write: (root, target, text, expected, maxBytes) => writeFenced(root, target, text, expected, "session workspace", maxBytes),
        ignore: (root, rule) => void ensureTelarGitignore(root, [{ alreadyCovered: [], ...rule }]),
      },
    },
  });
}

type EnginePluginOptions = { dir: string; daemonId: string; stateDir: string; withProcesses: boolean };

/**
 * The engine's plugin host: the bundled plugins, then whatever is installed under `dir`. Every door and tool wall
 * reaches a plugin through `resolve`, the one gate that refuses a plugin turned off for the Mac or the project.
 */
export function createEnginePlugins(store: EngineStore, { dir, daemonId, stateDir, withProcesses }: EnginePluginOptions) {
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
  const events = createPluginEvents({
    now: () => Date.now(),
    journal: (sessionId, entry) => {
      const appended = store.kernel.appendEvent(sessionId, entry);
      const legacy = legacyKernelEvent(entry);
      if (legacy) store.kernel.appendEvent(sessionId, legacy);
      return appended;
    },
    checkSession: (pluginId, sessionId) => void resolve(pluginId, sessionId),
    checkProject: (pluginId, projectId) => {
      if (!store.toolchains.runs(store.projectRegistry.get(projectId), pluginId)) throw new EngineStateError("invalid_request", `${pluginId} is not enabled for this project`);
    },
  });
  const bundled = builtInPlugins({ resolveHello: (sessionId) => resolve("hello", sessionId) });
  const complete = oneShotCompleter({
    store,
    spend: ({ usage, ...entry }) => appendOneShotUsage(store.paths.usageOneShot, { ...entry, tokens: usage.tokens, ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}) }),
  });
  const moduleFor = (loaded: LoadedExternalPlugin) =>
    externalPlugin(loaded, {
      resolve: (sessionId) => resolve(loaded.manifest.id, sessionId),
      emit: (event) => void events.emit(loaded.manifest.id, loaded.manifest.eventKinds, event),
      enabledAnywhere: () => store.projectRegistry.list().some((project) => store.toolchains.runs(project, loaded.manifest.id)),
      complete: (request) => complete(`plugin:${loaded.manifest.id}`, request),
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
  const host = new PluginHost([...bundledModules().map((entry) => bundledModulePlugin(store, resolve, events, complete, entry, withProcesses)), ...bundled, ...external.loaded.map(moduleFor)], {
    daemonId,
    stateDir,
    declaredPrefixes: [...BUNDLED_PLUGIN_TOOL_PREFIXES, ...bundledModulePrefixes(), ...installed.prefixes()],
    refused: external.refused.map(({ dir: folder, meta, error }) => ({ meta, error, installed: { linked: isSymlink(folder) } })),
    log: (message, detail) => console.warn(`[telar] ${message}${detail ? ` ${JSON.stringify(detail)}` : ""}`),
  });
  store.projectRegistry.attachPluginGitignore((id) => host.ready(id)?.meta.gitignore);
  return { host, installed, moduleFor, dir, events };
}
