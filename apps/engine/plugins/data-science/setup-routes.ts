import { DataScienceCreateEnvironment } from "@telar/engine-client";
import type { PluginEngine, PluginProject } from "../sdk";
import type { DataScienceOps } from "./operations";
import type { RequirementsSource } from "./packages";
import { projectSettings } from "./settings";
import { settingsView } from "./settings-view";

const words = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" && value.trim() ? value.split(/[\s,]+/).filter(Boolean) : undefined;

const MANAGERS = ["venv", "conda", "system", "telar"] as const;
const SOURCES = ["detected", "chosen", "telar"] as const;
const pick = <T extends string>(value: unknown, from: readonly T[], fallback: T): T => (from.includes(value as T) ? (value as T) : fallback);

/** A project's settings view and the verbs its blocks call: choose, probe, create, bootstrap and install. */
export function projectRoutes(ops: DataScienceOps): NonNullable<PluginEngine["project"]> {
  const jobs = new Map<string, { title: string; jobId: string }>();
  const drafts = new Map<string, { python?: string; stack: boolean }>();
  const draft = (projectId: string) => drafts.get(projectId) ?? { stack: true };
  const track = (project: PluginProject, title: string, started: { jobId: string }) => {
    jobs.set(project.projectId, { title, jobId: started.jobId });
    return started;
  };

  return {
    "GET settings": {
      beforeEnable: true,
      handle: async (_request, project) => {
        const { toolchain, environments, requirements, currentId } = await ops.environments(project.projectId);
        const configured = projectSettings(project.settings).python?.path;
        const packages = currentId
          ? await ops.packages(project.projectId).then((answer) => ({ packages: answer.packages }), (error: unknown) => ({ packages: [], error: error instanceof Error ? error.message : String(error) }))
          : undefined;
        const tracked = jobs.get(project.projectId);
        const read = tracked ? (() => { try { return ops.job(tracked.jobId); } catch { return undefined; } })() : undefined;
        return settingsView({
          enabled: project.enabled,
          ...(configured ? { configured } : {}),
          toolchain,
          environments,
          requirements,
          ...(currentId ? { currentId } : {}),
          ...(packages ? { packages } : {}),
          draft: draft(project.projectId),
          ...(tracked && read ? { job: { title: tracked.title, read } } : {}),
        });
      },
    },
    "POST use": {
      beforeEnable: true,
      handle: ({ input }, project) => {
        if (typeof input.path !== "string" || !input.path) throw new Error("an environment needs the interpreter it runs");
        ops.choose(project.projectId, { path: input.path, ...(typeof input.root === "string" ? { root: input.root } : {}), manager: pick(input.manager, MANAGERS, "system"), source: pick(input.source, SOURCES, "chosen") });
      },
    },
    "POST use-path": {
      beforeEnable: true,
      handle: async ({ input }, project) => {
        if (typeof input.path !== "string" || !input.path.trim()) throw new Error("type the path of a python, a venv or a conda environment");
        const probe = await ops.probe(project.projectId, input.path);
        if (!probe.ok) throw new Error(probe.reason ?? "that is not a usable Python");
        ops.choose(project.projectId, { path: probe.relativePath ?? probe.path, ...(probe.root ? { root: probe.root } : {}), manager: probe.manager ?? "system", source: "chosen" });
      },
    },
    "POST draft": {
      beforeEnable: true,
      handle: ({ input }, project) => {
        const current = draft(project.projectId);
        drafts.set(project.projectId, { ...current, ...(typeof input.python === "string" && input.python ? { python: input.python } : {}), ...(typeof input.stack === "string" ? { stack: input.stack !== "no" } : {}) });
      },
    },
    "POST create": {
      status: 202,
      beforeEnable: true,
      handle: async ({ input }, project) => {
        const { python, stack } = draft(project.projectId);
        const version = python ?? (await ops.toolchain()).pythons.find((p) => p.installed && !p.prerelease)?.minor ?? "3.13";
        const parsed = DataScienceCreateEnvironment.safeParse(
          input.manager === "conda" ? { manager: "conda", name: typeof input.name === "string" ? input.name.trim() : "", python: version, stack } : { manager: "venv", location: input.location === "telar" ? "telar" : "project", python: version, stack },
        );
        if (!parsed.success) throw new Error(input.manager === "conda" ? "name the conda environment" : "not a valid environment request");
        const request = parsed.data;
        const title = request.manager === "conda" ? `Creating conda env ${request.name}` : `Creating ${request.location === "project" ? ".venv" : "Telar's environment"} on Python ${version}`;
        const started = track(project, title, await ops.createEnvironment(project.projectId, request));
        void ops.adoptWhenCreated(project.projectId, started.jobId);
        return started;
      },
    },
    "POST bootstrap": {
      status: 202,
      beforeEnable: true,
      handle: async ({ input }, project) => {
        const what = input.what === "conda" ? "conda" : "uv";
        return track(project, what === "uv" ? "Installing uv" : "Installing Miniforge", await ops.bootstrap({ what }));
      },
    },
    "POST python": {
      status: 202,
      beforeEnable: true,
      handle: async ({ input }, project) => {
        if (typeof input.version !== "string" || !input.version) return {};
        return track(project, `Installing Python ${input.version}`, await ops.bootstrap({ what: "python", version: input.version }));
      },
    },
    "POST detect": { beforeEnable: true, handle: async () => void (await ops.toolchain(true)) },
    "GET environments": { beforeEnable: true, handle: (_request, project) => ops.environments(project.projectId) },
    "POST environments": {
      status: 202,
      beforeEnable: true,
      handle: ({ input }, project) => {
        const parsed = DataScienceCreateEnvironment.safeParse(input);
        if (!parsed.success) throw new Error("not a valid environment request");
        return ops.createEnvironment(project.projectId, parsed.data);
      },
    },
    "POST probe": {
      beforeEnable: true,
      handle: async ({ input }, project) => {
        if (typeof input.path !== "string") throw new Error("python path must be a string");
        return { probe: await ops.probe(project.projectId, input.path) };
      },
    },
    "GET packages": { handle: (_request, project) => ops.packages(project.projectId) },
    "POST packages": {
      status: 202,
      handle: async ({ input }, project) => {
        const add = words(input.add);
        const remove = words(input.remove);
        const requirements = typeof input.requirements === "string" && input.requirements ? (input.requirements as RequirementsSource) : undefined;
        if (!add && !remove && !requirements) return {};
        const title = requirements ? `Installing from ${requirements}` : add ? `Installing ${add.join(", ")}` : `Removing ${remove!.join(", ")}`;
        return track(project, title, await ops.install(project.projectId, { ...(add ? { add } : {}), ...(remove ? { remove } : {}), ...(requirements ? { requirements } : {}) }));
      },
    },
  };
}
