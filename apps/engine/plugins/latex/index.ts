import { z } from "zod";
import { PLUGIN_API_VERSION } from "@telar/engine-client";
import { JobRunner } from "../sdk/jobs";
import type { BundledPlugin, PluginEngine, PluginHost, PluginProject, PluginSession } from "../sdk";
import { LATEX_AUX_DIR } from "./compile";
import { LatexEngine, LatexMachineSettingsWrite, LatexSettings, machineSettings, projectSettings, resolveLatex } from "./settings";
import { LatexSetup, mainFileCandidates } from "./setup";
import { storeLatexCapability } from "./store-capability";
import { latexToolDeclarations, latexToolHandlers } from "./tools";
import type { CompileStatus, LatexCapability } from "./types";
import { compileView, machineView, projectView } from "./views";

const schema = (type: z.ZodType) => z.toJSONSchema(type, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

const list = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : undefined;

const SESSION_VERBS = ["toolchain", "compile", "status", "log", "packages", "install", "clean", "panel"];

function latexEngine(host: PluginHost): PluginEngine {
  const jobs = new JobRunner(() => host.now());
  const setup = new LatexSetup(jobs, () => host.now(), host.engineRoot);
  const compiles = new Map<string, CompileStatus>();

  const capability = (session: PluginSession): LatexCapability => {
    const resolved = resolveLatex(projectSettings(session.settings), machineSettings(session.machine), setup.managed.found()?.path);
    if (!resolved) {
      const refuse = async (): Promise<never> => {
        throw new Error("LaTeX has no TeX toolchain on this computer: choose one in the project's LaTeX settings, or install Telar's own under Settings → Plugins");
      };
      const status = async () => compiles.get(session.sessionId) ?? { status: "never" as const };
      return { toolchain: refuse, compile: refuse, status, log: refuse, packages: refuse, install: refuse, clean: refuse };
    }
    return storeLatexCapability({
      sessionId: session.sessionId,
      cwd: session.cwd,
      resolved,
      toolchain: () => setup.toolchain(),
      jobs,
      appendEvent: (event) => host.appendEvent(session.sessionId, event),
      now: () => host.now(),
      lastCompile: { get: () => compiles.get(session.sessionId), set: (status) => void compiles.set(session.sessionId, status) },
    });
  };

  const writeProject = (project: PluginProject, patch: Partial<LatexSettings>) => {
    const next: Record<string, unknown> = { ...projectSettings(project.settings), ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    host.writeProjectSettings(project.projectId, next);
  };

  return {
    tools: latexToolHandlers(capability),
    session: {
      toolchain: (_input, session) => capability(session).toolchain(),
      compile: (input, session) =>
        capability(session).compile({
          ...(typeof input.path === "string" && input.path.trim() ? { path: input.path.trim() } : {}),
          ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
        }),
      status: async (_input, session) => compiles.get(session.sessionId) ?? { status: "never" as const },
      log: (input, session) =>
        capability(session).log({
          ...(typeof input.tail === "number" ? { tail: input.tail } : {}),
          ...(typeof input.around === "number" ? { around: input.around } : {}),
          ...(typeof input.find === "string" ? { find: input.find } : {}),
        }),
      packages: (_input, session) => capability(session).packages(),
      install: (input, session) => capability(session).install({ ...(list(input.add) ? { add: list(input.add)! } : {}), ...(list(input.remove) ? { remove: list(input.remove)! } : {}) }),
      clean: (input, session) => capability(session).clean(input.pdf === true ? { pdf: true } : {}),
      panel: (_input, session) => compileView(compiles.get(session.sessionId) ?? { status: "never" }, projectSettings(session.settings).mainFile),
    },
    project: {
      "GET distributions": {
        beforeEnable: true,
        handle: async (_request, project) => ({ toolchain: await setup.toolchain(true), mainCandidates: mainFileCandidates(project.root), ...(projectSettings(project.settings).toolchain ? { current: projectSettings(project.settings).toolchain } : {}) }),
      },
      "GET packages": { handle: (_request, project) => setup.packages(projectSettings(project.settings)) },
      "POST packages": { status: 202, handle: ({ input }, project) => setup.install(project.projectId, projectSettings(project.settings), { ...(list(input.add) ? { add: list(input.add)! } : {}), ...(list(input.remove) ? { remove: list(input.remove)! } : {}) }) },
      "GET settings": {
        handle: async (_request, project) => {
          const settings = projectSettings(project.settings);
          const packages = project.enabled && settings.toolchain?.kind === "texlive" ? await setup.packages(settings).catch(() => undefined) : undefined;
          return projectView({
            enabled: project.enabled,
            settings,
            machine: machineSettings(project.machine),
            toolchain: await setup.toolchain(),
            mainCandidates: mainFileCandidates(project.root),
            ...(packages ? { packages } : {}),
            ...(setup.lastJob(project.projectId) ? { job: setup.lastJob(project.projectId)! } : {}),
          });
        },
      },
      "POST document": { handle: ({ input }, project) => writeProject(project, { mainFile: typeof input.mainFile === "string" && input.mainFile.trim() ? input.mainFile.trim() : undefined }) },
      "POST use": {
        handle: ({ input }, project) => {
          const engine = projectSettings(project.settings).toolchain?.engine;
          if (input.kind === "inherit") return writeProject(project, { toolchain: undefined });
          const kind = input.kind === "texlive" ? "texlive" : "tectonic";
          if (typeof input.path !== "string" || !input.path) throw new Error("a distribution needs the path it lives at");
          writeProject(project, { toolchain: { kind, path: input.path, ...(engine && kind === "texlive" ? { engine } : {}) } });
        },
      },
      "POST engine": {
        handle: ({ input }, project) => {
          const toolchain = projectSettings(project.settings).toolchain;
          if (!toolchain) throw new Error("choose a distribution first");
          const engine = LatexEngine.safeParse(input.engine);
          const { engine: _previous, ...rest } = toolchain;
          void _previous;
          writeProject(project, { toolchain: { ...rest, ...(engine.success ? { engine: engine.data } : {}) } });
        },
      },
      "POST detect": { handle: async () => void (await setup.toolchain(true)) },
      "POST install": { status: 202, handle: ({ input }, project) => setup.install(project.projectId, projectSettings(project.settings), { add: list(input.add) ?? [] }) },
      "POST bootstrap": { status: 202, handle: ({ input }, project) => setup.bootstrap({ what: input.what === "tinytex" ? "tinytex" : "tectonic" }, project.projectId) },
    },
    machine: {
      "POST bootstrap": {
        status: 202,
        handle: ({ input }) => {
          if (input.what !== "tectonic" && input.what !== "tinytex") throw new Error("not a valid bootstrap request");
          return setup.bootstrap({ what: input.what });
        },
      },
      "GET toolchain": { handle: async ({ query }) => ({ toolchain: await setup.toolchain(query.get("fresh") === "1") }) },
      "GET managed": { handle: () => ({ managed: setup.managedStatus() }) },
      "POST managed": { status: 202, handle: async () => ({ managed: await setup.installManaged() }) },
      "GET jobs/:id": { handle: ({ query, params }) => ({ job: setup.job(params.id!, Number(query.get("after") ?? "0") || 0) }) },
      "DELETE jobs/:id": { handle: ({ params }) => void setup.cancelJob(params.id!) },
      "GET defaults": { handle: async () => machineView(machineSettings(host.machineSettings()), await setup.toolchain(), setup.managedStatus(), setup.lastJob("machine")) },
      "POST default": {
        handle: ({ input }) => {
          const kind = input.kind === "managed" || input.kind === "texlive" ? input.kind : "tectonic";
          const toolchain = { kind, ...(typeof input.path === "string" && input.path ? { path: input.path } : {}) };
          host.writeMachineSettings({ ...host.machineSettings(), toolchain });
        },
      },
    },
    busy: () => jobs.list().some((job) => job.status === "running"),
    releaseSession: (sessionId) => void compiles.delete(sessionId),
    dispose: () => jobs.disposeAll(),
  };
}

export const latexPlugin: BundledPlugin = {
  manifest: {
    id: "latex",
    api: PLUGIN_API_VERSION,
    name: "LaTeX",
    version: "1.0.0",
    description: "Compile TeX documents, read the log, and manage packages.",
    icon: "FileText",
    toolPrefix: "latex",
    tools: latexToolDeclarations,
    briefing: [
      "This project has LaTeX on.",
      "`latex_compile` builds the project's main document (or a path you name) and `latex_log` reads the log around an error;",
      "`latex_packages` and `latex_install` manage the distribution's packages. Compile with these rather than invoking TeX from the shell.",
    ].join(" "),
    settingsSchema: schema(LatexSettings),
    machineSettingsSchema: schema(LatexMachineSettingsWrite),
    settings: [
      { id: "toolchain", scope: "machine", label: "Compiling", blurb: "How a compile runs here, unless the project says otherwise.", icon: "HardDrive", view: "defaults" },
      { id: "document", scope: "project", label: "LaTeX", blurb: "The document a compile builds, for this project.", icon: "FileText", view: "settings" },
    ],
    routes: {
      session: SESSION_VERBS,
      project: ["GET distributions", "GET packages", "POST packages", "GET settings", "POST document", "POST use", "POST engine", "POST detect", "POST install", "POST bootstrap"],
      machine: ["POST bootstrap", "GET toolchain", "GET managed", "POST managed", "GET jobs/:id", "DELETE jobs/:id", "GET defaults", "POST default"],
    },
    panels: [{ id: "compile", label: "Compile", verb: "panel" }],
    eventKinds: ["latex.compile.started", "latex.compile.finished"],
    gitignore: { rule: `${LATEX_AUX_DIR}/`, why: "LaTeX aux files from Telar's compiles", alreadyCovered: [".telar/", ".telar", "/.telar/", `${LATEX_AUX_DIR}/`] },
  },
  settingsSchema: LatexSettings,
  machineSettingsSchema: LatexMachineSettingsWrite,
  engine: latexEngine,
};
