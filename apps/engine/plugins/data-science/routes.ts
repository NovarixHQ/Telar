import { DataScienceBootstrap } from "@telar/engine-client";
import type { PluginEngine, PluginHost, PluginSession } from "../sdk";
import type { DsCapability } from "./capability";
import type { DataScienceOps } from "./operations";

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : undefined);
const defined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

/** The plots the session's kernel drew, for the Data view: listed, read one at a time, and pinned. */
function plotVerbs(attachments: PluginHost["attachments"]): NonNullable<PluginEngine["session"]> {
  const plot = (session: PluginSession, id: unknown) => {
    const found = attachments.list(session.sessionId, { tag: "plot" }).find((attachment) => attachment.id === id);
    if (!found) throw new Error("no such plot in this session");
    return found;
  };
  return {
    plots: (_input, session) => ({
      plots: attachments.list(session.sessionId, { tag: "plot" }).map((attachment) => ({
        id: attachment.id,
        ...(attachment.title ? { title: attachment.title } : {}),
        ...(attachment.producer ? { producer: attachment.producer } : {}),
        ...(attachment.createdAt ? { createdAt: attachment.createdAt } : {}),
        pinned: attachment.tags?.includes("pinned") ?? false,
      })),
    }),
    "plots/image": (input, session) => {
      const found = plot(session, input.id);
      return { mediaType: found.mediaType, dataB64: Buffer.from(attachments.bytes(session.sessionId, found.id)).toString("base64") };
    },
    "plots/pin": (input, session) => {
      const found = plot(session, input.id);
      const tags = (found.tags ?? []).filter((tag) => tag !== "pinned");
      attachments.tag(session.sessionId, found.id, input.pinned === true ? [...tags, "pinned"] : tags);
      return {};
    },
  };
}

/** The kernel, notebook and state verbs the cockpit and released clients call on a session. */
export function sessionVerbs(capability: (session: PluginSession) => DsCapability, attachments: PluginHost["attachments"]): NonNullable<PluginEngine["session"]> {
  const on = <T>(run: (ds: DsCapability, input: Record<string, unknown>, session: PluginSession) => T) => (input: Record<string, unknown>, session: PluginSession) => run(capability(session), input, session);
  return {
    ...plotVerbs(attachments),
    kernel: on((ds) => ds.kernel()),
    execute: on((ds, input) => ds.execute(defined({ code: String(input.code ?? ""), cellId: text(input.cellId), timeoutMs: number(input.timeoutMs), producer: text(input.producer) }))),
    interrupt: on((ds) => ds.interrupt()),
    restart: on((ds) => ds.restart()),
    vars: on((ds, input) => ds.vars(number(input.limit))),
    inspect: on((ds, input) => ds.inspect(String(input.name ?? ""), number(input.depth))),
    "notebook/read": on((ds, input) => ds.notebookRead(String(input.path ?? ""), defined({ from: number(input.from), to: number(input.to), withOutputs: input.withOutputs === true ? true : undefined }))),
    "notebook/edit": on((ds, input) => ds.notebookEdit(String(input.path ?? ""), input.edit as Parameters<DsCapability["notebookEdit"]>[1])),
    "notebook/run": on((ds, input) =>
      ds.notebookRun(String(input.path ?? ""), defined({ cellId: text(input.cellId), all: input.all === true ? true : undefined, stopOnError: typeof input.stopOnError === "boolean" ? input.stopOnError : undefined })),
    ),
    plot: on((ds, input) => ds.plot(defined({ code: String(input.code ?? ""), title: text(input.title) }))),
    snapshot: on((ds, input) => ds.snapshot(String(input.name ?? ""), strings(input.vars))),
    snapshots: on((ds) => ds.snapshots()),
    diff: on((ds, input) => ds.diff(String(input.from ?? ""), String(input.to ?? ""))),
    checkpoint: on((ds, input) => ds.checkpoint(defined({ action: String(input.action ?? "list") as "save" | "restore" | "list", name: text(input.name) }))),
    lineage: on((ds, input) => ds.lineage(text(input.of))),
    watches: on((ds) => ds.watches()),
    watch: on((ds, input) => ds.watch(defined({ name: String(input.name ?? ""), assert: text(input.assert), remove: input.remove === true ? true : undefined }))),
    env: on((ds, input) => ds.environment(text(input.use) ? { use: text(input.use)! } : {})),
    packages: on((ds) => ds.packages()),
    install: on((ds, input) => ds.install(defined({ add: strings(input.add), remove: strings(input.remove), requirements: text(input.requirements) }))),
    experiment: on((ds, input) =>
      ds.experiment(
        defined({
          action: String(input.action ?? "list") as "start" | "log" | "end" | "list",
          name: text(input.name),
          params: input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : undefined,
          metrics: input.metrics && typeof input.metrics === "object" ? (input.metrics as Record<string, number>) : undefined,
        }),
      ),
    ),
    table: on((ds, input) =>
      ds.table(String(input.path ?? ""), defined({
        offset: Math.max(0, number(input.offset) ?? 0),
        limit: Math.min(Math.max(1, number(input.limit) ?? 200), 1000),
        sort: text(input.sort),
        desc: input.desc === true ? true : undefined,
      })),
    ),
  };
}

export function machineRoutes(ops: DataScienceOps): NonNullable<PluginEngine["machine"]> {
  return {
    "POST bootstrap": {
      status: 202,
      handle: ({ input }) => {
        const parsed = DataScienceBootstrap.safeParse(input);
        if (!parsed.success) throw new Error("not a valid bootstrap request");
        return ops.bootstrap(parsed.data);
      },
    },
    "GET toolchain": { handle: async ({ query }) => ({ toolchain: await ops.toolchain(query.get("fresh") === "1") }) },
    "GET jobs/:id": { handle: ({ query, params }) => ({ job: ops.job(params.id!, Number(query.get("after") ?? "0") || 0) }) },
    "DELETE jobs/:id": { handle: ({ params }) => (ops.cancelJob(params.id!), {}) },
  };
}
