import fs from "node:fs";
import path from "node:path";
import { PluginNotFoundError, type PluginHost, type PluginProject, type PluginSession } from "../sdk";
import type { EnvironmentRow } from "./capability";
import { discoverEnvironments, environmentId, environmentRootOf, type EnvManager, type PythonEnvironment } from "./environments";
import type { JobRead, JobRunner } from "../sdk/jobs";
import { canonicalName, declaredDependencies, type InstallCommand, installCommandFor, installSteps, listPackages, type PackageInfo, projectRequirements, removeSteps, type RequirementsSource, requirementsStep } from "./packages";
import { machineDefaults, projectSettings, type DataScienceSettings } from "./settings";
import { preflightPython, type PythonPreflight, relativisePythonPath, resolvePythonPath } from "./python-env";
import { type BootstrapRequest, type CreateEnvironmentRequest, planBootstrap, planEnvironment, telarVenvDir, telarVenvPython } from "./telar-venv";
import { toolchainStatus, type Toolchain } from "./toolchain";
import { adoptBinaryDir, findBinary } from "../sdk/probe";

const TOOLCHAIN_CACHE_MS = 5_000;

export type DataScienceOpsHost = Pick<PluginHost, "engineRoot" | "now" | "project" | "writeProjectSettings" | "machineSettings" | "files"> & {
  restartKernel(session: PluginSession): Promise<unknown>;
};

type ConfiguredEnvironment = { id: string; manager: EnvManager; root: string; python: string };

function invalid(error: unknown): Error {
  return new Error(error instanceof Error ? error.message : String(error));
}

function environmentRow(env: PythonEnvironment, inUse: boolean): EnvironmentRow {
  return { id: env.id, name: env.name, manager: env.manager, root: env.root, python: env.python, ...(env.preflight.version ? { version: env.preflight.version } : {}), inUse };
}

/** The settings page's and the agent's environment and package operations; installs run as `jobs`. */
export class DataScienceOps {
  private toolchainCache?: { until: number; value: Promise<Toolchain> };

  constructor(
    private readonly jobs: JobRunner,
    private readonly host: DataScienceOpsHost,
  ) {}

  /** uv, conda, Homebrew and the Pythons they see; cached briefly because each answer is several spawns. */
  toolchain(fresh = false): Promise<Toolchain> {
    if (!fresh && this.toolchainCache && this.host.now() < this.toolchainCache.until) return this.toolchainCache.value;
    const value = toolchainStatus();
    this.toolchainCache = { until: this.host.now() + TOOLCHAIN_CACHE_MS, value };
    void value.catch(() => { this.toolchainCache = undefined; });
    return value;
  }

  private settings(project: PluginProject): DataScienceSettings {
    return projectSettings(project.settings);
  }

  /** Paths inside the checkout are stored relative, so a worktree session resolves `.venv/bin/python` against its own tree. */
  async environments(projectId: string, workspace?: string): Promise<{ toolchain: Toolchain; environments: (PythonEnvironment & { path: string })[]; requirements: RequirementsSource[]; declared?: string[]; currentId?: string }> {
    const project = this.host.project(projectId);
    const base = workspace ?? project.root;
    const toolchain = await this.toolchain(true);
    const telarVenv = telarVenvDir(this.host.engineRoot, projectId);
    const declared = declaredDependencies(base);
    const found = await discoverEnvironments(base, { toolchain, ...(telarVenvPython(telarVenv) ? { telarVenv } : {}), ...(declared.length ? { dists: declared } : {}) });
    const environments = found.map((env) => ({ ...env, path: relativisePythonPath(base, env.python) }));
    const current = this.settings(project).python ? this.current(project, base) : undefined;
    return { toolchain, environments, requirements: projectRequirements(base), ...(declared.length ? { declared } : {}), ...(current ? { currentId: current.id } : {}) };
  }

  async environmentRows(projectId: string, workspace: string): Promise<EnvironmentRow[]> {
    const { environments, currentId } = await this.environments(projectId, workspace);
    return environments.map((env) => environmentRow(env, env.id === currentId));
  }

  /** Persists the choice on the project, then restarts the session's kernel into it. `target` is an id, name, root or interpreter path. */
  async useEnvironment(session: PluginSession, target: string): Promise<{ environments: EnvironmentRow[]; switched: string }> {
    const workspace = session.cwd;
    const { environments } = await this.environments(session.projectId, workspace);
    const match = environments.find((env) => env.id === target || env.name === target || env.root === target || env.python === target || env.path === target);
    if (!match) throw new Error(`no environment matches "${target}" — the choices are ${environments.map((env) => `${env.name} (${env.id})`).join(", ") || "none"}`);
    if (!match.preflight.ok) throw new Error(`${match.name} is unusable: ${match.preflight.reason}`);
    const python = {
      source: match.manager === "telar" ? ("telar" as const) : ("chosen" as const),
      path: match.path,
      resolvedAt: this.host.now(),
      manager: match.manager,
      root: relativisePythonPath(workspace, match.root),
    };
    this.host.writeProjectSettings(session.projectId, { ...this.settings(this.host.project(session.projectId)), python });
    await this.host.restartKernel({ ...session, settings: { ...session.settings, python } });
    return { environments: environments.map((env) => environmentRow(env, env.id === match.id)), switched: match.name };
  }

  /** Older configs stored only the path; the manager is then read off the directory. */
  private current(project: PluginProject, workspace = project.root): ConfiguredEnvironment | undefined {
    const config = this.settings(project).python;
    if (!config) return undefined;
    const python = resolvePythonPath(workspace, config.path);
    if (!fs.existsSync(python)) return undefined;
    const detected = environmentRootOf(python);
    const root = config.root ? resolvePythonPath(workspace, config.root) : detected?.root ?? path.dirname(python);
    const manager: EnvManager = config.manager ?? (root.startsWith(telarVenvDir(this.host.engineRoot, project.projectId)) ? "telar" : detected?.manager ?? "system");
    return { id: environmentId(root), manager, root, python };
  }

  private requireCurrent(project: PluginProject, workspace?: string): ConfiguredEnvironment {
    const env = this.current(project, workspace);
    if (!env) throw new Error("this project has no Python environment configured");
    return env;
  }

  /** The Mac's default packages apply only to an environment Telar creates, never to one that already exists. */
  async createEnvironment(projectId: string, request: CreateEnvironmentRequest): Promise<{ jobId: string }> {
    const project = this.host.project(projectId);
    const toolchain = await this.toolchain(true);
    let plan;
    try {
      const defaults = machineDefaults(this.host.machineSettings());
      plan = planEnvironment(request, toolchain, {
        projectRoot: project.root,
        telarVenv: telarVenvDir(this.host.engineRoot, projectId),
        ...(defaults.packages ? { defaultPackages: defaults.packages } : {}),
      });
    } catch (error) {
      throw invalid(error);
    }
    const { root, python } = plan;
    return this.jobs.start({
      kind: "create",
      lock: `${projectId}:env`,
      steps: plan.steps,
      onDone: async () => {
        if (!fs.existsSync(python)) throw new Error("the environment was created but has no python executable");
        if (request.manager === "venv" && request.location === "project") {
          try {
            this.host.files.ignore(project.root, { rule: ".venv/", alreadyCovered: [".venv", "/.venv", "/.venv/", ".venv/"], why: "the Python environment uv created for this project" });
          } catch { /* not a repo, or unwritable — the venv still works */ }
        }
        const manager: EnvManager = request.manager === "venv" && request.location === "telar" ? "telar" : request.manager;
        return { path: relativisePythonPath(project.root, python), root: relativisePythonPath(project.root, root), manager, source: manager === "telar" ? "telar" : "detected" };
      },
    });
  }

  /** Uses the environment a create job made, once it finishes; a failed or cancelled job changes nothing. */
  async adoptWhenCreated(projectId: string, jobId: string): Promise<void> {
    const read = await this.jobs.wait(jobId, 60 * 60_000);
    const made = read.result as { path: string; root: string; manager: EnvManager; source: "detected" | "chosen" | "telar" } | undefined;
    if (read.status !== "ok" || !made) return;
    this.choose(projectId, made);
  }

  /** Writes the project's interpreter choice, keeping its other settings. */
  choose(projectId: string, env: { path: string; root?: string; manager: EnvManager; source: "detected" | "chosen" | "telar" }): void {
    const settings = this.settings(this.host.project(projectId));
    this.host.writeProjectSettings(projectId, { ...settings, python: { source: env.source, path: env.path, resolvedAt: this.host.now(), manager: env.manager, ...(env.root ? { root: env.root } : {}) } });
  }

  /** `direct` marks the packages the project declares, when it declares any. */
  async packages(projectId: string, workspace?: string): Promise<{ packages: (PackageInfo & { direct?: boolean })[]; environment: { manager: EnvManager; root: string; python: string; command: InstallCommand } }> {
    const project = this.host.project(projectId);
    const root = workspace ?? project.root;
    const env = this.requireCurrent(project, workspace);
    const toolchain = await this.toolchain();
    const declared = new Set(declaredDependencies(root, 500));
    try {
      const packages = (await listPackages(env, toolchain)).map((pkg) => (declared.size ? { ...pkg, direct: declared.has(canonicalName(pkg.name)) } : pkg));
      return { packages, environment: { manager: env.manager, root: env.root, python: env.python, command: installCommandFor(env, toolchain, { root }) } };
    } catch (error) {
      throw invalid(error);
    }
  }

  /** The manager's own tool does the work, so a conda env stays solvable. */
  async install(projectId: string, input: { add?: string[]; remove?: string[]; requirements?: RequirementsSource }, workspace?: string): Promise<{ jobId: string }> {
    const project = this.host.project(projectId);
    const env = this.requireCurrent(project, workspace);
    const toolchain = await this.toolchain();
    const context = { root: workspace ?? project.root };
    try {
      const steps = [
        ...(input.remove?.length ? removeSteps(env, input.remove, toolchain, context) : []),
        ...(input.add?.length ? installSteps(env, input.add, toolchain, context) : []),
        ...(input.requirements ? [requirementsStep(env, context.root, input.requirements, toolchain)] : []),
      ];
      if (!steps.length) throw new Error("nothing to install or remove");
      return this.jobs.start({ kind: "install", lock: `${env.id}:packages`, steps });
    } catch (error) {
      throw invalid(error);
    }
  }

  /** A tool that lands where PATH does not look yet has its directory adopted, so the next probe finds it without a restart. */
  async bootstrap(request: BootstrapRequest): Promise<{ jobId: string }> {
    const toolchain = await this.toolchain(true);
    let plan;
    try {
      plan = planBootstrap(request, toolchain);
    } catch (error) {
      throw invalid(error);
    }
    const expect = plan.expectBinary;
    return this.jobs.start({
      kind: `bootstrap:${request.what}`,
      lock: `bootstrap:${request.what}`,
      steps: plan.steps,
      onDone: () => {
        this.toolchainCache = undefined;
        if (!expect) return {};
        const found = findBinary(expect);
        if (!found) throw new Error(`${expect} was installed but cannot be found — open a new terminal, check your PATH, then detect again`);
        adoptBinaryDir(found);
        return { binary: found };
      },
    });
  }

  job(jobId: string, after?: number): JobRead {
    try {
      return this.jobs.read(jobId, after);
    } catch (error) {
      throw new PluginNotFoundError(error instanceof Error ? error.message : String(error));
    }
  }

  cancelJob(jobId: string): void {
    this.jobs.cancel(jobId);
  }

  /** Probes one interpreter a person typed or picked: a python binary, a venv or a conda env dir. */
  async probe(projectId: string, target: string): Promise<PythonPreflight & { relativePath?: string; root?: string; manager?: EnvManager }> {
    const project = this.host.project(projectId);
    const resolved = resolvePythonPath(project.root, target.trim());
    const python = telarVenvPython(resolved) ?? resolved;
    const probe = await preflightPython(python, undefined, undefined, declaredDependencies(project.root));
    if (!probe.ok) return probe;
    const env = environmentRootOf(python);
    return {
      ...probe,
      relativePath: relativisePythonPath(project.root, python),
      root: relativisePythonPath(project.root, env?.root ?? path.dirname(python)),
      manager: env?.manager ?? "system",
    };
  }
}
