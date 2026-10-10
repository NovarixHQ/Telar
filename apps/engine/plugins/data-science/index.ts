import { z } from "zod";
import { DataScienceMachineSettingsWrite, PLUGIN_API_VERSION, type PluginEventNote } from "@telar/engine-client";
import { JobRunner } from "../sdk/jobs";
import { capabilityTools, type BundledPlugin, type PluginEngine, type PluginHost, type PluginSession } from "../sdk";
import type { DsCapability } from "./capability";
import { dsTools } from "./ds-tools";
import { KernelHost } from "./kernel-host";
import { notebookTools } from "./notebook-tools";
import { DataScienceOps } from "./operations";
import { machineRoutes, projectRoutes, sessionVerbs } from "./routes";
import { DataScienceSettings, resolveInterpreter } from "./settings";
import { DsFiles } from "./state-files";
import { NOTEBOOK_MAX_BYTES, storeDsCapability } from "./store-capability";
import { tableWindow } from "./table";
import { removeTelarVenv, telarVenvDir } from "./telar-venv";
import { DATA_SCIENCE_VIEWS } from "./views";

const schema = (type: z.ZodType) => z.toJSONSchema(type, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

const tools = capabilityTools<DsCapability>((tool, capability) => [...notebookTools(tool, capability), ...dsTools(tool, capability)], { readOnly: ["ds_packages", "ds_kernel"] });

function dataScienceEngine(host: PluginHost): PluginEngine {
  const jobs = new JobRunner(() => host.now());
  const emit = (sessionId: string, name: string, data: Record<string, unknown>, note?: PluginEventNote) => {
    try {
      host.emit({ scope: "session", sessionId, name, data, ...(note ? { note } : {}) });
    } catch {
      // a kernel outliving its session, or a plugin just turned off, has nowhere to report
    }
  };
  const projectOf = new Map<string, string>();
  const kernels = host.processes
    ? new KernelHost({
        engineRoot: host.engineRoot,
        processes: host.processes,
        events: {
          onState: (sessionId, state, reason) => emit(sessionId, "kernel.state", { state, ...(reason ? { reason } : {}) }),
          persistImage: (sessionId, input) => host.attachments.put(sessionId, { name: `${input.producer}.${input.mediaType === "image/svg+xml" ? "svg" : "png"}`, tags: ["plot"], ...input }).id,
        },
      })
    : undefined;

  const capability = (session: PluginSession): DsCapability => {
    const resolved = resolveInterpreter(session);
    if ("refusal" in resolved) throw new Error(resolved.refusal);
    if (!kernels) throw new Error("this engine has no kernel host");
    const { sessionId, projectId, cwd } = session;
    projectOf.set(sessionId, projectId);
    return storeDsCapability({
      sessionId,
      cwd,
      python: resolved.pythonPath,
      telarVenv: telarVenvDir(host.engineRoot, projectId, session.worktree),
      host: kernels,
      files: new DsFiles(session.stateDir),
      // A notebook with plots passes the editor's 512 KB ceiling in one cell, so both fences take the notebook cap.
      readFile: (target) => host.files.read(cwd, target, NOTEBOOK_MAX_BYTES),
      writeFile: (target, text, expected) => host.files.write(cwd, target, text, expected, NOTEBOOK_MAX_BYTES),
      putAttachment: (input) => host.attachments.put(sessionId, input),
      attachmentBytes: (id) => host.attachments.bytes(sessionId, id),
      emit: (name, data, note) => emit(sessionId, name, data, note),
      now: () => host.now(),
      packages: () => ops.packages(projectId, cwd),
      startInstall: (input) => ops.install(projectId, input as Parameters<DataScienceOps["install"]>[1], cwd),
      waitJob: (jobId, timeoutMs) => jobs.wait(jobId, timeoutMs),
      environments: async () => ({ environments: await ops.environmentRows(projectId, cwd) }),
      useEnvironment: (target) => ops.useEnvironment(session, target),
      table: (target, options) => tableWindow(cwd, target, options, { read: (file) => host.files.read(cwd, file), execute: (input) => capability(session).execute(input) }),
    });
  };
  const ops = new DataScienceOps(jobs, { ...host, restartKernel: (session) => capability(session).restart() });
  const live = (projectId: string) => (kernels?.list() ?? []).filter((kernel) => projectOf.get(kernel.sessionId) === projectId);

  return {
    tools: tools.handlers(capability),
    session: sessionVerbs(capability),
    project: projectRoutes(ops),
    machine: machineRoutes(ops),
    available: (session) => "pythonPath" in resolveInterpreter(session),
    busy: (projectId) => live(projectId).some((kernel) => kernel.state === "busy"),
    releaseProject: async (projectId) => void (await Promise.all(live(projectId).map((kernel) => kernels?.dispose(kernel.sessionId, "data science disabled")))),
    releaseSession: async (sessionId, reason, session) => {
      await kernels?.dispose(sessionId, reason);
      projectOf.delete(sessionId);
      if (session?.worktree) removeTelarVenv(telarVenvDir(host.engineRoot, session.projectId, session.worktree));
    },
    dispose: async () => {
      await kernels?.disposeAll("engine shutting down");
      jobs.disposeAll();
    },
  };
}

export const dataSciencePlugin: BundledPlugin = {
  manifest: {
    id: "data-science",
    api: PLUGIN_API_VERSION,
    name: "Data science",
    version: "1.0.0",
    description: "A Python kernel per session: cells, notebooks, plots and snapshots.",
    icon: "FlaskConical",
    toolPrefix: ["ds", "notebook"],
    tools: tools.declarations,
    briefing: [
      "This project has data science on: a Python kernel per session, in the session's own directory.",
      "`notebook_*` opens, edits and runs `.ipynb` cells in that kernel; `ds_*` works with its state (vars, plots, snapshots, packages).",
      "Prefer these over shelling out to Python, and read each tool's description for its contract.",
    ].join(" "),
    settingsSchema: schema(DataScienceSettings),
    machineSettingsSchema: schema(DataScienceMachineSettingsWrite),
    settings: [
      { id: "environment", scope: "project", label: "Data science", blurb: "The Python environment this project's kernel runs in.", icon: "FlaskConical" },
      { id: "defaults", scope: "machine", label: "Data science defaults", blurb: "What a project on this computer inherits when it has not chosen for itself.", icon: "FlaskConical" },
    ],
    routes: {
      session: ["kernel", "execute", "interrupt", "restart", "vars", "inspect", "notebook/read", "notebook/edit", "notebook/run", "plot", "snapshot", "snapshots", "diff", "checkpoint", "lineage", "watches", "watch", "env", "packages", "install", "experiment", "table"],
      project: ["GET environments", "POST environments", "POST probe", "GET packages", "POST packages"],
      machine: ["POST bootstrap", "GET toolchain", "GET jobs/:id", "DELETE jobs/:id"],
    },
    eventKinds: ["kernel.state", "cell.output", "watch.violated"],
    sessionStateDir: "ds",
    viewers: [
      { id: "notebook", label: "Notebook", entry: "notebook.html", extensions: [".ipynb"], mimes: ["application/x-ipynb+json"] },
      { id: "table", label: "Table", entry: "table.html", extensions: [".csv", ".tsv", ".parquet"], mimes: ["text/csv", "text/tab-separated-values"] },
    ],
    gitignore: { rule: ".telar/ds/", why: "kernel state and snapshots from Telar's cells", alreadyCovered: [".telar/", ".telar", "/.telar/", ".telar/ds/"] },
  },
  settingsSchema: DataScienceSettings,
  machineSettingsSchema: DataScienceMachineSettingsWrite,
  assets: DATA_SCIENCE_VIEWS,
  engine: dataScienceEngine,
};
