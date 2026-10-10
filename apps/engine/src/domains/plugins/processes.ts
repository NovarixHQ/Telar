import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PluginProcessInfo, PluginProcesses, PluginProcessSpec } from "../../../plugins/sdk";

const KEY = /^[A-Za-z0-9_-]{1,128}$/;
const STOP_GRACE_MS = 5_000;

type Entry = { child: ChildProcessWithoutNullStreams; spec: PluginProcessSpec; startedAt: number; adopted: number[]; exited: boolean };

const kill = (pid: number | undefined, signal: NodeJS.Signals) => {
  if (!pid) return;
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
};

/**
 * The long-lived children one plugin module owns, keyed by the module. Each start writes a pid file, so the next
 * engine reaps what a crash left behind; the host stops them all when the plugin is disabled or the engine stops.
 */
export class ModuleProcesses implements PluginProcesses {
  private readonly entries = new Map<string, Entry>();
  private closed = false;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.reapOrphans();
  }

  private pidFile(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  private record(key: string, entry: Entry): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.pidFile(key), JSON.stringify({ pid: entry.child.pid, adopted: entry.adopted, startedAt: entry.startedAt }), { mode: 0o600 });
  }

  private reapOrphans(): void {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.dir).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        const { pid, adopted } = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number; adopted?: number[] };
        for (const orphan of [...(adopted ?? []), pid]) kill(orphan, "SIGKILL");
      } catch {
        // a torn file has nothing left to reap
      }
      fs.rmSync(file, { force: true });
    }
  }

  start(key: string, spec: PluginProcessSpec): ChildProcessWithoutNullStreams {
    if (this.closed) throw new Error("this plugin is shutting down");
    if (!KEY.test(key)) throw new Error(`not a process key: ${key}`);
    const previous = this.entries.get(key);
    if (previous && !previous.exited) throw new Error(`process ${key} is already running`);
    const child = spawn(spec.command, spec.args ?? [], { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
    const entry: Entry = { child, spec, startedAt: this.now(), adopted: [], exited: false };
    this.entries.set(key, entry);
    child.once("exit", () => {
      entry.exited = true;
      for (const pid of entry.adopted) kill(pid, "SIGKILL");
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        fs.rmSync(this.pidFile(key), { force: true });
      }
    });
    child.once("error", () => undefined);
    if (child.pid) this.record(key, entry);
    return child;
  }

  adopt(key: string, pid: number): void {
    const entry = this.entries.get(key);
    if (!entry || entry.exited) return;
    entry.adopted.push(pid);
    this.record(key, entry);
  }

  list(): PluginProcessInfo[] {
    return [...this.entries].map(([key, entry]) => ({ key, ...(entry.child.pid ? { pid: entry.child.pid } : {}), startedAt: entry.startedAt, alive: !entry.exited }));
  }

  async restart(key: string): Promise<ChildProcessWithoutNullStreams> {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`no process ${key}`);
    await this.stop(key);
    return this.start(key, entry.spec);
  }

  async stop(key: string, graceMs = STOP_GRACE_MS): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (!entry.exited) {
      const exited = new Promise<void>((resolve) => entry.child.once("exit", () => resolve()));
      entry.child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))]);
      clearTimeout(timer);
      if (!entry.exited) {
        entry.child.kill("SIGKILL");
        await exited;
      }
    }
    for (const pid of entry.adopted) kill(pid, "SIGKILL");
    if (this.entries.get(key) === entry) this.entries.delete(key);
    fs.rmSync(this.pidFile(key), { force: true });
  }

  async stopAll(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries.keys()].map((key) => this.stop(key)));
  }
}
