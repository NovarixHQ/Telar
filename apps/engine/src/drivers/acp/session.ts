import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TELAR_BROWSER_MCP_SERVER, TELAR_MCP_SERVER, type TurnObservation } from "@telar/engine-client";
import { agentEnv } from "../../platform/process/agent-env";
import { driverBriefings } from "../briefings";
import { ACP_CAPABILITIES } from "../capabilities";
import { ProviderUnavailableError, withAttachedFiles, type DriverResult, type DriverRun, type TurnDriver } from "../contract";
import { AcpTurn, record } from "./items";
import { acpMcpServers, writeLease } from "./mcp-bridge";
import { applyChoices, configOptions } from "./options";
import { answerPermission } from "./permissions";
import { AcpConnection, AcpRpcError } from "./rpc";

type AcpClock = { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };

export type AcpDriverOptions = {
  env?: Record<string, string | undefined>;
  clock?: AcpClock;
  cancelGraceMs?: number;
  idleMs?: number;
};

type Runtime = {
  identity: string;
  rpc: AcpConnection;
  sessionId: string;
  options: ReturnType<typeof configOptions>;
  models: string[];
  images: boolean;
  leaseDir: string;
  fresh: boolean;
  onUpdate?: (update: Record<string, unknown>) => void;
  gate?: DriverRun["onRequest"];
  signal?: AbortSignal;
  idle?: unknown;
};

const PROTOCOL_VERSION = 1;
const realClock: AcpClock = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

const identityOf = (run: DriverRun): string =>
  JSON.stringify([
    run.binaryPath,
    run.extraArgs ?? [],
    run.cwd ?? null,
    run.env ?? null,
    run.providerInstanceId ?? null,
    (run.mcpServers ?? []).map((server) => server.id).sort(),
    Boolean(run.telarSocketLease),
    Boolean(run.browserSocket),
  ]);

const modelIds = (created: Record<string, unknown>): string[] => {
  const available = record(created.models).availableModels;
  return (Array.isArray(available) ? available : []).flatMap((model) => (typeof record(model).modelId === "string" ? [record(model).modelId as string] : []));
};

export function createAcpDriver(options: AcpDriverOptions = {}): TurnDriver {
  const clock = options.clock ?? realClock;
  const runtimes = new Map<string, Runtime>();
  const close = (sessionId: string): void => {
    const runtime = runtimes.get(sessionId);
    if (!runtime) return;
    runtimes.delete(sessionId);
    clock.clearTimeout(runtime.idle);
    runtime.rpc.kill();
    fs.rmSync(runtime.leaseDir, { recursive: true, force: true });
  };

  const start = async (run: DriverRun, command: string): Promise<Runtime> => {
    const leaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-acp-"));
    const rpc = new AcpConnection(command, run.extraArgs ?? [], { cwd: run.cwd, env: { ...agentEnv(), ...options.env, ...run.env }, recordDir: process.env.TELAR_ACP_RECORD });
    const runtime = { identity: identityOf(run), rpc, leaseDir, fresh: true, sessionId: "", options: [], models: [], images: false } as Runtime;
    rpc.onClose = () => {
      if (runtimes.get(run.sessionId) === runtime) close(run.sessionId);
    };
    rpc.onNotification = (method, params) => {
      if (method === "session/update" && params.sessionId === runtime.sessionId) runtime.onUpdate?.(record(params.update));
    };
    rpc.onRequest = async ({ method, params }) => {
      if (method === "session/request_permission") return answerPermission(params, runtime.gate, runtime.signal ?? new AbortController().signal);
      throw new AcpRpcError(-32601, `Telar does not offer ${method}`);
    };
    try {
      const initialized = record(
        await rpc.request("initialize", {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "telar", title: "Telar", version: "0.1.0" },
        }),
      );
      const capabilities = record(initialized.agentCapabilities);
      const http = record(capabilities.mcpCapabilities).http === true;
      const created = record(await rpc.request("session/new", { cwd: run.cwd ?? os.homedir(), mcpServers: acpMcpServers(run, http, leaseDir) }));
      if (typeof created.sessionId !== "string") throw new Error("the agent started no session");
      runtime.sessionId = created.sessionId;
      runtime.options = configOptions(created);
      runtime.models = modelIds(created);
      runtime.images = record(capabilities.promptCapabilities).image === true;
      return runtime;
    } catch (error) {
      rpc.kill();
      fs.rmSync(leaseDir, { recursive: true, force: true });
      throw error;
    }
  };

  const claim = async (run: DriverRun): Promise<Runtime> => {
    const command = run.binaryPath;
    if (!command) throw new ProviderUnavailableError("This agent has no command to run. Set its binary path in Providers.");
    if (runtimes.get(run.sessionId)?.identity !== identityOf(run)) close(run.sessionId);
    let runtime = runtimes.get(run.sessionId);
    if (runtime) clock.clearTimeout(runtime.idle);
    else {
      runtime = await start(run, command);
      runtimes.set(run.sessionId, runtime);
    }
    for (const [name, lease] of [[TELAR_MCP_SERVER, run.telarSocketLease], [TELAR_BROWSER_MCP_SERVER, run.browserSocket]] as const) {
      if (lease) writeLease(path.join(runtime.leaseDir, `${name}.json`), lease);
    }
    return runtime;
  };

  const runTurn = async (run: DriverRun): Promise<DriverResult> => {
    const active = await claim(run);
    const pending: TurnObservation[] = [];
    let flushing = Promise.resolve();
    const flush = (): Promise<void> => {
      flushing = flushing.then(async () => {
        if (pending.length > 0) await run.onObservations(pending.splice(0, pending.length));
      });
      return flushing;
    };
    const emit = (observation: TurnObservation): void => {
      pending.push(observation);
      if (pending.length === 1) queueMicrotask(() => void flush());
    };
    const turn = new AcpTurn(run.runId ?? `${Date.now()}`, emit);
    const fresh = active.fresh;
    active.fresh = false;
    emit({ kind: "provider.session", providerSessionId: active.sessionId });
    if (fresh && run.providerSessionId && run.providerSessionId !== active.sessionId) {
      emit({ kind: "runtime.warning", message: "The agent was restarted and does not remember the earlier turns of this session." });
    }
    for (const message of await applyChoices(active.rpc, active, { model: run.model, effort: run.effort })) emit({ kind: "runtime.warning", message });

    active.onUpdate = (update) => turn.handle(update);
    active.gate = run.onRequest;
    active.signal = run.signal;
    let killTimer: unknown;
    const cancel = (): void => {
      active.rpc.notify("session/cancel", { sessionId: active.sessionId });
      killTimer = clock.setTimeout(() => close(run.sessionId), options.cancelGraceMs ?? 5_000);
    };
    if (run.signal.aborted) cancel();
    else run.signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await active.rpc.request("session/prompt", { sessionId: active.sessionId, prompt: promptBlocks(run, fresh, active.images) });
      turn.finish();
      const usage = turn.usage(response);
      if (usage) emit({ kind: "usage", usage });
      await flush();
      if (run.signal.aborted || record(response).stopReason === "cancelled") throw run.signal.reason ?? new Error("driver cancelled");
      return { text: turn.text, providerSessionId: active.sessionId, ...(usage ? { usage } : {}) };
    } catch (error) {
      turn.finish();
      await flush();
      throw run.signal.aborted ? (run.signal.reason ?? error) : error;
    } finally {
      clock.clearTimeout(killTimer);
      run.signal.removeEventListener("abort", cancel);
      delete active.onUpdate;
      delete active.gate;
      if (runtimes.get(run.sessionId) === active) active.idle = clock.setTimeout(() => close(run.sessionId), options.idleMs ?? 15 * 60_000);
    }
  };

  return {
    capabilities: ACP_CAPABILITIES,
    run: runTurn,
    dispose() {
      for (const sessionId of runtimes.keys()) close(sessionId);
    },
  };
}

// Telar's briefings travel inline, once per agent session, because ACP has no system channel.
function promptBlocks(run: DriverRun, fresh: boolean, images: boolean): Array<Record<string, unknown>> {
  const files = run.attachments ?? [];
  const inlineImages = images ? files.filter((file) => file.mediaType.startsWith("image/")) : [];
  const named = files.filter((file) => !inlineImages.includes(file));
  const prompt = withAttachedFiles(run.notification ? run.notification.summary : run.prompt, named);
  const text = [...(fresh ? driverBriefings(run) : []), prompt].filter((part) => part.trim()).join("\n\n");
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...inlineImages.map((file): Record<string, unknown> => {
      try {
        return { type: "image", mimeType: file.mediaType, data: fs.readFileSync(file.path).toString("base64") };
      } catch {
        return { type: "text", text: `Attached file: ${file.name} at ${file.path}` };
      }
    }),
  ];
}
