import fs from "node:fs";
import {
  applyPluginPatch,
  DataScienceConfig as DataScienceConfigSchema,
  machineAllows,
  machineSettings,
  pluginBlock,
  pluginEffectivelyEnabled,
  PROJECT_PLUGINS_VERSION,
  ProjectPlugins as ProjectPluginsSchema,
  readProjectPlugins,
  type DataScienceConfig,
  type PluginPatch,
  type Project,
  type ProjectPlugins,
  type Session,
} from "@telar/engine-client";
import { resolvePythonPath } from "./data-science/python-env";
import { toolchainStatus, type Toolchain } from "./data-science/toolchain";
import type { Kernel } from "../../platform/kernel";
import { DataScienceMachineSettings as DataScienceMachineSettingsSchema } from "./data-science/plugin";
import { workspaceRootOf } from "../sessions";

const TOOLCHAIN_CACHE_MS = 5_000;

// Read from the plugin map only; settings that no longer parse are dropped, and the switch survives.
function typedPluginBlock<T>(project: Project, id: string, schema: { safeParse(value: unknown): { success: boolean; data?: T } }): T | undefined {
  const block = pluginBlock(project, id);
  if (!block) return undefined;
  const parsed = schema.safeParse(block);
  return parsed.success ? parsed.data : schema.safeParse({ enabled: block.enabled === true }).data;
}
export const dataScienceBlock = (project: Project): DataScienceConfig | undefined => typedPluginBlock(project, "data-science", DataScienceConfigSchema);

type ToolchainDeps = { getProject: (projectId: string) => Project };

/**
 * The Mac's plugin ceiling, which interpreter a session resolves to, and the
 * toolchain probes behind the Plugins pane. Disabling a plugin for the Mac never
 * touches a project's settings.
 */
export class PluginToolchains {
  private dsToolchainCache?: { until: number; value: Promise<Toolchain> };

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

  /**
   * The interpreter a session runs on: the project's own (a relative path
   * resolves against the session's tree, never the project root's), else the
   * Mac's absolute default. Nothing when off, or the file isn't there.
   */
  resolveDataScience(session: Session): { pythonPath: string } | undefined {
    const outcome = this.dataScienceOutcome(session);
    return "pythonPath" in outcome ? outcome : undefined;
  }

  dataScienceRefusal(session: Session): string {
    const outcome = this.dataScienceOutcome(session);
    return "refusal" in outcome ? outcome.refusal : "data science is available for this session";
  }

  private dataScienceOutcome(session: Session): { pythonPath: string } | { refusal: string } {
    if (!machineAllows(this.machine(), "data-science")) return { refusal: "data science is turned off for this computer" };
    const project = this.projectOf(session);
    const config = project && dataScienceBlock(project);
    if (!config?.enabled) return { refusal: "data science is not enabled for this session's project" };
    const machineDefault = DataScienceMachineSettingsSchema.safeParse(machineSettings(this.machine(), "data-science"));
    const chosen = config.python?.path ?? (machineDefault.success ? machineDefault.data.python : undefined);
    if (!chosen) {
      return { refusal: "data science has no Python interpreter: choose one in the project's settings, or set a default Python for this computer under Settings → Plugins" };
    }
    const pythonPath = resolvePythonPath(workspaceRootOf(session), chosen);
    if (!fs.existsSync(pythonPath)) return { refusal: `data science's Python interpreter is not on disk: ${pythonPath}` };
    return { pythonPath };
  }

  /** uv, conda, Homebrew and the Pythons they see; cached briefly because each answer is several spawns. */
  dataScienceToolchain(fresh = false): Promise<Toolchain> {
    if (!fresh && this.dsToolchainCache && this.kernel.now() < this.dsToolchainCache.until) return this.dsToolchainCache.value;
    const value = toolchainStatus();
    this.dsToolchainCache = { until: this.kernel.now() + TOOLCHAIN_CACHE_MS, value };
    void value.catch(() => { this.dsToolchainCache = undefined; });
    return value;
  }

  forgetDataScienceToolchain(): void {
    this.dsToolchainCache = undefined;
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
