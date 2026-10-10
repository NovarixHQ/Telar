/// <reference path="./bridge-source.d.ts" />
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import BRIDGE_SOURCE from "./bridge.py" with { type: "text" };
import type { PluginProcesses } from "../sdk";
import { KernelBridge, type SpawnBridge } from "./kernel-bridge";
import { CellOutput, plotTitleFrom, withoutPlotTitle, type ExecResult, type KernelState } from "./outputs";

export type KernelSpec = {
  sessionId: string;
  bridgePython: string;
  kernelPython: string;
  sitePackages: string[];
  cwd: string;
};

export type KernelInfo = {
  sessionId: string;
  state: KernelState;
  startedAt?: number;
  lastUsedAt?: number;
  executionCount?: number;
  pid?: number;
  modules?: Record<string, boolean>;
  kernelPython?: string;
  executable?: string;
};

type KernelHostEvents = {
  onState?: (sessionId: string, state: KernelState, reason?: string) => void;
  onOutput?: (sessionId: string, execId: string, cellId: string | undefined, output: CellOutput) => void;
  persistImage?: (sessionId: string, input: { mediaType: string; data: Uint8Array; producer: string; title?: string }) => string;
};

type Entry = {
  bridge: KernelBridge;
  info: KernelInfo;
  waiters: Map<string, CellOutput[]>;
  chain: Promise<unknown>;
  caption?: { producer?: string; title?: string };
};

export type KernelHostOptions = {
  engineRoot: string;
  /** Owns the bridge processes; absent, the bridge spawns its own (tests). */
  processes?: PluginProcesses;
  idleMs?: number;
  maxKernels?: number;
  now?: () => number;
  spawnImpl?: SpawnBridge;
  events?: KernelHostEvents;
};

export class KernelHost {
  private readonly kernels = new Map<string, Entry>();
  private readonly reaper: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly maxKernels: number;

  constructor(private readonly options: KernelHostOptions) {
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? 30 * 60_000;
    this.maxKernels = options.maxKernels ?? 8;
    this.reaper = setInterval(() => this.reap(), 60_000);
    this.reaper.unref?.();
  }

  bridgeFile(): string {
    const hash = crypto.createHash("sha256").update(BRIDGE_SOURCE).digest("hex").slice(0, 16);
    const dir = path.join(this.options.engineRoot, "python");
    const file = path.join(dir, `bridge-${hash}.py`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, BRIDGE_SOURCE, { mode: 0o600 });
    }
    return file;
  }

  private spawnFor(sessionId: string): SpawnBridge | undefined {
    if (this.options.spawnImpl) return this.options.spawnImpl;
    const processes = this.options.processes;
    return processes && ((python, script, { cwd, env }) => processes.start(sessionId, { command: python, args: ["-u", script], cwd, env }));
  }

  info(sessionId: string): KernelInfo | undefined {
    return this.kernels.get(sessionId)?.info;
  }

  list(): KernelInfo[] {
    return [...this.kernels.values()].map((entry) => entry.info);
  }

  async ensure(spec: KernelSpec): Promise<KernelInfo> {
    const existing = this.kernels.get(spec.sessionId);
    if (existing && existing.bridge.alive) return existing.info;
    if (existing) this.kernels.delete(spec.sessionId);

    while (this.kernels.size >= this.maxKernels) {
      const oldest = [...this.kernels.entries()].sort((a, b) => (a[1].info.lastUsedAt ?? 0) - (b[1].info.lastUsedAt ?? 0))[0];
      if (!oldest) break;
      await this.dispose(oldest[0], "evicted: too many live kernels");
    }

    const spawnImpl = this.spawnFor(spec.sessionId);
    const bridge = new KernelBridge(spec.bridgePython, this.bridgeFile(), { cwd: spec.cwd, ...(spawnImpl ? { spawnImpl } : {}) });
    const info: KernelInfo = { sessionId: spec.sessionId, state: "starting", startedAt: this.now(), lastUsedAt: this.now(), pid: bridge.pid, kernelPython: spec.kernelPython };
    const entry: Entry = { bridge, info, waiters: new Map(), chain: Promise.resolve() };
    this.kernels.set(spec.sessionId, entry);

    bridge.onNotification = ({ method, params }) => {
      if (method === "status") {
        const state = String(params.state) as KernelState;
        info.state = state;
        this.options.events?.onState?.(spec.sessionId, state, typeof params.reason === "string" ? params.reason : undefined);
        return;
      }
      if (method === "output") {
        const execId = String(params.execId);
        const cellId = typeof params.cellId === "string" ? params.cellId : undefined;
        const parsed = CellOutput.safeParse(params.output);
        if (!parsed.success) return;
        const [carried] = withoutPlotTitle([parsed.data]);
        const probed = plotTitleFrom([parsed.data]);
        if (probed) entry.caption = { ...entry.caption, title: probed };
        if (!carried) return;
        const output = this.persist(spec.sessionId, carried, cellId ?? entry.caption?.producer ?? execId, entry.caption?.title);
        entry.waiters.get(execId)?.push(output);
        this.options.events?.onOutput?.(spec.sessionId, execId, cellId, output);
        return;
      }
      if (method === "exec_done" && typeof params.executionCount === "number") info.executionCount = params.executionCount;
    };
    bridge.onClose = (error) => {
      if (this.kernels.get(spec.sessionId) === entry) this.kernels.delete(spec.sessionId);
      info.state = "dead";
      this.options.events?.onState?.(spec.sessionId, "dead", error.message);
    };

    try {
      const started = await bridge.request<{ pid?: number }>("start", { cwd: spec.cwd, sitePackages: spec.sitePackages, kernelPython: spec.kernelPython });
      if (started.pid) this.options.processes?.adopt(spec.sessionId, started.pid);
      const probe = await bridge.request<{ modules: Record<string, boolean>; executable?: string }>("probe", { modules: ["pandas", "matplotlib", "duckdb", "pyarrow", "polars"] });
      info.modules = probe.modules;
      if (probe.executable) info.executable = probe.executable;
    } catch (error) {
      bridge.kill();
      this.kernels.delete(spec.sessionId);
      throw error;
    }
    return info;
  }

  private persist(sessionId: string, output: CellOutput, producer: string, title?: string): CellOutput {
    if (output.kind !== "image" || !output.dataB64 || !this.options.events?.persistImage) return output;
    const data = new Uint8Array(Buffer.from(output.dataB64, "base64"));
    const attachmentId = this.options.events.persistImage(sessionId, { mediaType: output.mediaType, data, producer, ...(title ? { title } : {}) });
    const { dataB64: _dropped, ...rest } = output;
    return { ...rest, attachmentId };
  }

  private entry(sessionId: string): Entry {
    const entry = this.kernels.get(sessionId);
    if (!entry || !entry.bridge.alive) throw new Error("no live kernel for this session; start one first");
    entry.info.lastUsedAt = this.now();
    return entry;
  }

  execute(sessionId: string, input: { code: string; cellId?: string; timeoutMs?: number; producer?: string; title?: string }): Promise<ExecResult> {
    const entry = this.entry(sessionId);
    const run = async (): Promise<ExecResult> => {
      const outputs: CellOutput[] = [];
      entry.caption = { ...(input.producer ? { producer: input.producer } : {}), ...(input.title ? { title: input.title } : {}) };
      const placeholder = `pending_${crypto.randomUUID()}`;
      entry.waiters.set(placeholder, outputs);
      const remap = ({ method, params }: { method: string; params: Record<string, unknown> }) => {
        if (method === "output" && typeof params.execId === "string" && !entry.waiters.has(params.execId)) {
          entry.waiters.set(params.execId, outputs);
        }
      };
      const previous = entry.bridge.onNotification;
      entry.bridge.onNotification = (n) => { remap(n); previous?.(n); };
      try {
        const reply = await entry.bridge.request<Omit<ExecResult, "outputs">>("execute", { code: input.code, ...(input.cellId ? { cellId: input.cellId } : {}), ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) });
        return { ...reply, outputs };
      } finally {
        entry.bridge.onNotification = previous;
        entry.caption = undefined;
        for (const [key, value] of entry.waiters) if (value === outputs) entry.waiters.delete(key);
      }
    };
    const next = entry.chain.then(run, run);
    entry.chain = next.catch(() => undefined);
    return next;
  }

  interrupt(sessionId: string): Promise<void> {
    return this.entry(sessionId).bridge.request("interrupt").then(() => undefined);
  }

  restart(sessionId: string): Promise<void> {
    const entry = this.entry(sessionId);
    const next = entry.chain.then(() => entry.bridge.request("restart", { clearState: true }), () => entry.bridge.request("restart", { clearState: true }));
    entry.chain = next.catch(() => undefined);
    return next.then(() => undefined);
  }

  call<T>(sessionId: string, method: "list_vars" | "inspect_var" | "snapshot" | "checkpoint" | "restore" | "probe", params?: unknown): Promise<T> {
    const entry = this.entry(sessionId);
    const next = entry.chain.then(() => entry.bridge.request<T>(method, params), () => entry.bridge.request<T>(method, params));
    entry.chain = next.catch(() => undefined);
    return next;
  }

  async dispose(sessionId: string, reason: string): Promise<void> {
    const entry = this.kernels.get(sessionId);
    if (!entry) return;
    this.kernels.delete(sessionId);
    const killer = setTimeout(() => entry.bridge.kill(), 5_000);
    try { await entry.bridge.request("shutdown"); } catch { }
    clearTimeout(killer);
    entry.bridge.kill();
    await this.options.processes?.stop(sessionId, 1_000);
    entry.info.state = "dead";
    this.options.events?.onState?.(sessionId, "dead", reason);
  }

  private reap(): void {
    const cutoff = this.now() - this.idleMs;
    for (const [sessionId, entry] of this.kernels) {
      if (entry.info.state === "idle" && (entry.info.lastUsedAt ?? 0) < cutoff) void this.dispose(sessionId, "idle");
    }
  }

  async disposeAll(reason: string): Promise<void> {
    clearInterval(this.reaper);
    await Promise.all([...this.kernels.keys()].map((sessionId) => this.dispose(sessionId, reason)));
  }
}
