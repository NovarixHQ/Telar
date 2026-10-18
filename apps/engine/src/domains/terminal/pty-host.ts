import fs from "node:fs";
import { terminalEnv as withTerminalEnv } from "./env";
import { nodePtySpawner, type PtyProcess, type PtySpawn } from "./node-pty";
import { readProcessTable, terminalProcesses, type ProcessRow } from "./process-table";

export type CloseReason = "close" | "session" | "quit";
type TerminalOrigin = "user" | "agent" | "run";

export type TerminalEnding = {
  id: string;
  pid?: number;
  fate: "exited" | "failed";
  exitCode?: number;
  signal?: string;
  closed?: CloseReason;
  error?: string;
  at?: number;
};

export type TerminalFacts = {
  id: string;
  pid?: number;
  sessionId?: string;
  origin?: string;
  title?: string;
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  startedAt?: number;
};

export type TerminalActivity = { id: string; sessionId?: string; origin?: string; title?: string; active: boolean; processes: number; command?: string };

export type TerminalSink = { data(chunk: string): void; ending(ending: TerminalEnding): void };

export type TerminalOpenRequest = {
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  sessionId?: string;
  origin?: TerminalOrigin;
  title?: string;
};

export type TerminalOpened = { id: string; pid?: number; ending?: TerminalEnding };

export type PtyHostOptions = {
  version?: string;
  now?: () => number;
  closeGraceMs?: number;
  spawnPty?: PtySpawn;
  killTree?: (pid: number, signal: NodeJS.Signals | 0) => void;
  listProcesses?: () => Promise<ProcessRow[]>;
  stat?: (cwd: string) => Promise<fs.Stats>;
  access?: (cwd: string) => Promise<void>;
};

type Record_ = {
  id: string;
  sink: TerminalSink;
  pty: PtyProcess;
  pid: number;
  tty?: string;
  origin: TerminalOrigin;
  sessionId?: string;
  title?: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  startedAt: number;
  closing: Promise<void> | null;
  closeReason: CloseReason | null;
  onLeaderExit: (() => void) | null;
  inputs: number;
  echoed: number;
  outputs: number;
};

const TERM = "xterm-256color";
const CWD_DEADLINE_MS = 5000;

export function ptyEnv(base: Record<string, string | undefined>, version?: string): Record<string, string> {
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (typeof value === "string") strings[key] = value;
  delete strings.ELECTRON_RUN_AS_NODE;
  const env = withTerminalEnv(strings as NodeJS.ProcessEnv) as Record<string, string>;
  env.TERM_PROGRAM = "Telar";
  if (version) env.TERM_PROGRAM_VERSION = version;
  return env;
}

const shortText = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function size(value: unknown, fallback: number): number {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? Math.min(rounded, 9999) : fallback;
}

function facts(record: Record_): TerminalFacts {
  const { id, pid, sessionId, origin, title, shell, cwd, cols, rows, startedAt } = record;
  return { id, pid, sessionId, origin, title, shell, cwd, cols, rows, startedAt };
}

export class PtyHost {
  private readonly terminals = new Map<string, Record_>();
  private sequence = 0;
  private disposed = false;
  private spawner: PtySpawn | undefined;
  private readonly now: () => number;
  private readonly closeGraceMs: number;
  private readonly version: string | undefined;
  private readonly killTree: (pid: number, signal: NodeJS.Signals | 0) => void;
  private readonly listProcesses: () => Promise<ProcessRow[]>;
  private readonly stat: (cwd: string) => Promise<fs.Stats>;
  private readonly access: (cwd: string) => Promise<void>;

  constructor(options: PtyHostOptions = {}) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    this.closeGraceMs = options.closeGraceMs ?? 1000;
    this.spawner = options.spawnPty;
    this.killTree = options.killTree ?? ((pid, signal) => process.kill(-pid, signal));
    this.listProcesses = options.listProcesses ?? readProcessTable;
    this.stat = options.stat ?? ((cwd) => fs.promises.stat(cwd));
    this.access = options.access ?? ((cwd) => fs.promises.access(cwd, fs.constants.X_OK));
  }

  get size(): number {
    return this.terminals.size;
  }

  async open(request: TerminalOpenRequest, sink: TerminalSink): Promise<TerminalOpened> {
    this.refuseWhenDisposed();
    const id = `term_${(this.sequence += 1).toString(36)}_${this.now().toString(36)}`;
    const baseEnv = request.env ?? process.env;
    const shell = request.shell?.trim() ? request.shell : baseEnv.SHELL?.trim() || "/bin/sh";
    const cols = size(request.cols, 80);
    const rows = size(request.rows, 24);
    const failed = (error: string): TerminalOpened => ({ id, ending: { id, fate: "failed", error, at: this.now() } });

    const refusal = await this.unusableCwd(request.cwd);
    this.refuseWhenDisposed();
    if (refusal) return failed(refusal);

    let pty: PtyProcess;
    try {
      this.spawner ??= nodePtySpawner();
      pty = this.spawner(shell, request.args ?? [], { name: TERM, cols, rows, cwd: request.cwd || undefined, env: ptyEnv(baseEnv, this.version) });
    } catch (error) {
      return failed(messageOf(error));
    }

    const record: Record_ = {
      id,
      sink,
      pty,
      pid: pty.pid,
      tty: typeof pty.ptsName === "string" ? pty.ptsName : undefined,
      origin: request.origin ?? "user",
      sessionId: shortText(request.sessionId, 200),
      title: shortText(request.title, 200),
      shell,
      cwd: request.cwd,
      cols,
      rows,
      startedAt: this.now(),
      closing: null,
      closeReason: null,
      onLeaderExit: null,
      inputs: 0,
      echoed: 0,
      outputs: 0,
    };
    this.terminals.set(id, record);
    pty.on?.("error", () => {});
    pty.onData((data) => {
      if (this.terminals.get(id) !== record) return;
      record.outputs += 1;
      record.echoed = record.inputs;
      sink.data(data);
    });
    pty.onExit((ending) => {
      this.settle(record, {
        fate: "exited",
        exitCode: typeof ending?.exitCode === "number" ? ending.exitCode : undefined,
        signal: ending?.signal ? String(ending.signal) : undefined,
        ...(record.closeReason ? { closed: record.closeReason } : {}),
      });
      record.onLeaderExit?.();
    });
    return { id, pid: record.pid };
  }

  write(id: string, data: string): boolean {
    const record = this.terminals.get(id);
    if (!record || typeof data !== "string") return false;
    record.inputs += 1;
    record.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const record = this.terminals.get(id);
    if (!record) return false;
    record.cols = size(cols, record.cols);
    record.rows = size(rows, record.rows);
    record.pty.resize(record.cols, record.rows);
    return true;
  }

  kill(id: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
    const record = this.terminals.get(id);
    if (!record) return false;
    try {
      this.killTree(record.pid, signal);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
    return true;
  }

  list(): TerminalFacts[] {
    return [...this.terminals.values()].map(facts);
  }

  sessionCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.terminals.values()) if (record.sessionId) counts[record.sessionId] = (counts[record.sessionId] ?? 0) + 1;
    return counts;
  }

  async close(id: string): Promise<boolean> {
    const record = this.terminals.get(id);
    if (!record) return false;
    await this.closeRecords([record], "close");
    return true;
  }

  async closeSession(sessionId: string): Promise<number> {
    const records = [...this.terminals.values()].filter((record) => record.sessionId === sessionId);
    await this.closeRecords(records, "session");
    return records.length;
  }

  async closeIdle(sessionId: string): Promise<string[]> {
    const records = [...this.terminals.values()].filter((record) => record.sessionId === sessionId && !record.closing);
    if (records.length === 0) return [];
    const marks = new Map(records.map((record) => [record, record.inputs + record.outputs]));
    const rows = await this.snapshot();
    if (!rows) return [];
    const idle = records.filter(
      (record) =>
        this.terminals.get(record.id) === record &&
        record.inputs === record.echoed &&
        record.inputs + record.outputs === marks.get(record) &&
        !terminalProcesses(record, rows).active,
    );
    await this.closeRecords(idle, "session");
    return idle.map((record) => record.id);
  }

  async closeAll(): Promise<number> {
    const records = [...this.terminals.values()];
    await this.closeRecords(records, "quit");
    return records.length;
  }

  async active(ids?: string[]): Promise<TerminalActivity[]> {
    const wanted = ids ? new Set(ids) : undefined;
    const records = [...this.terminals.values()].filter((record) => !wanted || wanted.has(record.id));
    if (records.length === 0) return [];
    const rows = await this.snapshot();
    return records.map((record) => {
      const activity = rows ? terminalProcesses(record, rows) : { active: true, processes: 0, command: undefined };
      return { id: record.id, sessionId: record.sessionId, origin: record.origin, title: record.title, active: activity.active, processes: activity.processes, command: activity.command };
    });
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.closeRecords([...this.terminals.values()], "quit");
  }

  private refuseWhenDisposed(): void {
    if (this.disposed) throw new Error("Telar's terminal host is shutting down and will not start another shell.");
  }

  private async snapshot(): Promise<ProcessRow[] | null> {
    try {
      return await this.listProcesses();
    } catch {
      return null;
    }
  }

  private async closeRecords(records: Record_[], reason: CloseReason): Promise<void> {
    if (records.length === 0) return;
    const rows = records.some((record) => !record.closing) ? await this.snapshot() : null;
    await Promise.all(records.map((record) => this.closeRecord(record, rows, reason)));
  }

  private closeRecord(record: Record_, rows: ProcessRow[] | null, reason: CloseReason): Promise<void> {
    if (record.closing) return record.closing;
    record.closeReason = reason;
    const groups = rows ? terminalProcesses(record, rows).groups : [record.pid];
    record.closing = new Promise<void>((resolve) => {
      const pending = new Set<number>();
      try {
        this.killTree(record.pid, "SIGHUP");
      } catch {}
      for (const group of groups) {
        try {
          this.killTree(group, "SIGTERM");
          pending.add(group);
        } catch {}
      }
      if (pending.size === 0) return resolve();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        record.onLeaderExit = null;
        resolve();
      };
      record.onLeaderExit = () => {
        for (const group of pending) {
          try {
            this.killTree(group, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") pending.delete(group);
          }
        }
        if (pending.size === 0) finish();
      };
      timer = setTimeout(() => {
        timer = null;
        for (const group of pending) {
          try {
            this.killTree(group, "SIGKILL");
          } catch {}
        }
        finish();
      }, this.closeGraceMs);
    });
    return record.closing;
  }

  private settle(record: Record_, ending: Omit<TerminalEnding, "id" | "pid" | "at">): void {
    if (this.terminals.get(record.id) !== record) return;
    this.terminals.delete(record.id);
    record.sink.ending({ id: record.id, pid: record.pid, at: this.now(), ...ending });
  }

  private async unusableCwd(cwd: string | undefined): Promise<string | null> {
    if (cwd === undefined || cwd === "") return null;
    const deadline = <T>(promise: Promise<T>) => {
      let timer: ReturnType<typeof setTimeout>;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the disk did not answer within ${CWD_DEADLINE_MS / 1000} seconds`)), CWD_DEADLINE_MS);
      });
      return Promise.race([promise, late]).finally(() => clearTimeout(timer));
    };
    let stats: fs.Stats;
    try {
      stats = await deadline(this.stat(cwd));
    } catch (error) {
      return `Telar cannot start a terminal in ${cwd}: ${messageOf(error)}. No process was started.`;
    }
    if (!stats.isDirectory()) return `Telar cannot start a terminal in ${cwd}: it exists but is not a directory. No process was started.`;
    try {
      await deadline(this.access(cwd));
    } catch (error) {
      return `Telar cannot start a terminal in ${cwd}: it is a directory this process may not enter (${messageOf(error)}). No process was started.`;
    }
    return null;
  }
}
