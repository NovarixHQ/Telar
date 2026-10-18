import { PtyHost, type PtyHostOptions } from "../src/domains/terminal/pty-host";
import type { PtyProcess, PtySpawn } from "../src/domains/terminal/node-pty";

export type FakePty = PtyProcess & {
  writes: string[];
  resizes: Array<[number, number]>;
  emitData(data: string): void;
  emitExit(ending?: { exitCode?: number; signal?: number | string }): void;
};

export function fakePty(pid = 4242, ptsName?: string): FakePty {
  const handlers: { data: Array<(data: string) => void>; exit: Array<(ending: { exitCode?: number; signal?: number | string }) => void> } = { data: [], exit: [] };
  const pty: FakePty = {
    pid,
    ptsName,
    writes: [],
    resizes: [],
    write: (data) => void pty.writes.push(data),
    resize: (cols, rows) => void pty.resizes.push([cols, rows]),
    on: () => {},
    onData: (handler) => void handlers.data.push(handler),
    onExit: (handler) => void handlers.exit.push(handler),
    emitData: (data) => handlers.data.forEach((handler) => handler(data)),
    emitExit: (ending = { exitCode: 0 }) => handlers.exit.forEach((handler) => handler(ending)),
  };
  return pty;
}

const anyCwdIsFine = { stat: async () => ({ isDirectory: () => true }) as never, access: async () => {} };

export function fakeHost(options: PtyHostOptions & { spawn?: PtySpawn } = {}) {
  const ptys: FakePty[] = [];
  const dead = new Set<number>();
  const signals: Array<[number, NodeJS.Signals | 0]> = [];
  const busy = new Set<number>();
  const spawnPty: PtySpawn = (file, args, spawnOptions) => {
    if (options.spawn) return options.spawn(file, args, spawnOptions);
    const pty = fakePty(40_000 + ptys.length);
    ptys.push(pty);
    return pty;
  };
  const host = new PtyHost({
    ...anyCwdIsFine,
    listProcesses: async () => [...busy].map((pid) => ({ pid: pid + 1000, ppid: pid, pgid: pid + 1000, tpgid: -1, tty: "?", command: "sleep 60" })),
    spawnPty,
    killTree: (pid, signal) => {
      signals.push([pid, signal]);
      if (dead.has(pid)) throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      if (signal === "SIGHUP" || signal === "SIGTERM" || signal === "SIGKILL") {
        dead.add(pid);
        ptys.find((pty) => pty.pid === pid)?.emitExit({ exitCode: 0, signal: 1 });
      }
    },
    ...options,
  });
  return { host, ptys, signals, busy };
}
