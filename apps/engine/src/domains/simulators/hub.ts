import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { atomicWrite } from "../../platform/fs/atomic";
import type { ProcessHandle, ProcessRunner } from "../../platform/process/runner";

export type HubDeps = {
  root: string;
  runner: ProcessRunner;
  fetch: typeof fetch;
  env: () => NodeJS.ProcessEnv;
  reservePort: () => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type HubStatus = { state: "idle" | "starting" | "ready" | "failed"; detail?: string };

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;
const STABLE_UPTIME_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;

export function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function logHubOutput(text: string): void {
  for (const line of text.split("\n")) if (line.trim()) console.error(`[simulators] ${line.trimEnd()}`);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The hub runs as a child bound to loopback only: its own routes include shell exec and are unauthenticated. */
export class SimulatorHub {
  private running?: { handle: ProcessHandle; origin: string; startedAt: number };
  private starting?: Promise<string>;
  private stopped = true;
  private backoffMs = 0;
  private failure?: string;

  constructor(private readonly deps: HubDeps) {}

  private get record() {
    return path.join(this.deps.root, "simulators", "hub.json");
  }

  status(): HubStatus {
    if (this.running) return { state: "ready" };
    if (this.starting) return { state: "starting" };
    return this.failure ? { state: "failed", detail: this.failure } : { state: "idle" };
  }

  origin(): string | undefined {
    return this.running?.origin;
  }

  start(entry: string): Promise<string> {
    this.stopped = false;
    if (this.running) return Promise.resolve(this.running.origin);
    this.starting ??= this.spawn(entry)
      .then((origin) => {
        this.failure = undefined;
        return origin;
      })
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => (this.starting = undefined));
    return this.starting;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.starting?.catch(() => undefined);
    const running = this.running;
    this.running = undefined;
    this.failure = undefined;
    if (running) {
      running.handle.stop();
      await running.handle.exited;
    }
    fs.rmSync(this.record, { force: true });
  }

  private async spawn(entry: string): Promise<string> {
    await this.reapStale(entry);
    const port = await this.deps.reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const handle = this.deps.runner.start("node", [entry, "--port", String(port), "--host", "127.0.0.1", "--hide-sidebar", "--hide-boot-device"], {
      env: { ...this.deps.env(), FORCE_COLOR: "0", NO_COLOR: "1" },
      onStderr: logHubOutput,
    });
    let exited = false;
    void handle.exited.then(() => (exited = true));
    try {
      await this.waitReady(origin, () => exited);
    } catch (error) {
      handle.stop();
      throw error;
    }
    if (this.stopped) {
      handle.stop();
      throw new Error("The simulator hub was turned off while it started.");
    }
    this.running = { handle, origin, startedAt: this.deps.now() };
    if (handle.pid) atomicWrite(this.record, { pid: handle.pid, port, entryPath: entry });
    void handle.exited.then(() => this.restart(entry, handle));
    return origin;
  }

  private async waitReady(origin: string, exited: () => boolean): Promise<void> {
    const deadline = this.deps.now() + READY_TIMEOUT_MS;
    while (this.deps.now() < deadline) {
      if (exited()) throw new Error("The simulator hub exited while starting.");
      try {
        if ((await this.deps.fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(2_000) })).ok) return;
      } catch {}
      await this.deps.sleep(READY_POLL_MS);
    }
    throw new Error("The simulator hub did not become ready within 30 seconds.");
  }

  private async restart(entry: string, handle: ProcessHandle): Promise<void> {
    if (this.running?.handle !== handle) return;
    let stable = this.deps.now() - this.running.startedAt >= STABLE_UPTIME_MS;
    this.running = undefined;
    while (!this.stopped && !this.running) {
      this.backoffMs = stable ? 0 : Math.min(Math.max(this.backoffMs * 2, 1_000), MAX_BACKOFF_MS);
      stable = false;
      await this.deps.sleep(this.backoffMs);
      if (this.stopped || this.running) return;
      try {
        await this.start(entry);
      } catch {}
    }
  }

  /** A hub left by an engine that died is stopped only if its command line is still ours: pids get reused. */
  private async reapStale(entry: string): Promise<void> {
    let stale: { pid?: unknown };
    try {
      stale = JSON.parse(fs.readFileSync(this.record, "utf8"));
    } catch {
      return;
    }
    const pid = stale.pid;
    if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 && alive(pid)) {
      const { stdout } = await this.deps.runner.run("ps", ["-o", "command=", "-p", String(pid)], { timeoutMs: 5_000 });
      if (stdout.includes(entry)) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
      }
    }
    fs.rmSync(this.record, { force: true });
  }
}
