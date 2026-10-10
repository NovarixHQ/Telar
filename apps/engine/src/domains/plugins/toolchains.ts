import {
  applyPluginPatch,
  machineAllows,
  pluginEffectivelyEnabled,
  PROJECT_PLUGINS_VERSION,
  ProjectPlugins as ProjectPluginsSchema,
  readProjectPlugins,
  type PluginPatch,
  type Project,
  type ProjectPlugins,
  type Session,
} from "@telar/engine-client";
import type { Kernel } from "../../platform/kernel";

type ToolchainDeps = { getProject: (projectId: string) => Project };

/** The Mac's plugin ceiling and which plugins a session's project runs. Disabling one for the Mac never touches a project's settings. */
export class PluginToolchains {
  constructor(
    private readonly kernel: Kernel,
    private readonly deps: ToolchainDeps,
  ) {}

  /** An absent file allows everything, so a Mac that predates it keeps its plugins. */
  machine(): ProjectPlugins {
    const parsed = ProjectPluginsSchema.safeParse(this.kernel.readDocument(this.kernel.paths.machinePlugins));
    return parsed.success ? parsed.data : { version: PROJECT_PLUGINS_VERSION, entries: {} };
  }

  updateMachine(patch: PluginPatch): ProjectPlugins {
    const next = applyPluginPatch(this.machine(), patch);
    this.kernel.writeDocument(this.kernel.paths.machinePlugins, next);
    return structuredClone(next);
  }

  runs(project: Project, id: string): boolean {
    return pluginEffectivelyEnabled(this.machine(), readProjectPlugins(project).plugins, id);
  }

  /** The plugin ids a session's project turned on, under the Mac's ceiling; a worker builds its walls from this. */
  enabledIds(session: Session): string[] {
    const project = this.projectOf(session);
    if (!project) return [];
    const machine = this.machine();
    return Object.entries(readProjectPlugins(project).plugins.entries)
      .filter(([id, config]) => config.enabled && machineAllows(machine, id))
      .map(([id]) => id)
      .sort();
  }

  private projectOf(session: Session): Project | undefined {
    if (!session.projectId) return undefined;
    try {
      return this.deps.getProject(session.projectId);
    } catch {
      return undefined;
    }
  }
}
