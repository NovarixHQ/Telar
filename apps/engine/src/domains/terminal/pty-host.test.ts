import { describe, expect, jest, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeHost, fakePty } from "../../../test/pty-fakes";
import { ensureSpawnHelper, spawnHelperCandidates } from "./node-pty";
import { parseProcessTable, terminalProcesses } from "./process-table";
import { ptyEnv, type TerminalEnding } from "./pty-host";

function sink() {
  const data: string[] = [];
  const endings: TerminalEnding[] = [];
  return { data, endings, handlers: { data: (chunk: string) => void data.push(chunk), ending: (ending: TerminalEnding) => void endings.push(ending) } };
}

describe("opening a terminal", () => {
  test("starts the person's shell with Telar's terminal environment and reports its pid", async () => {
    const spawned: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
    const { host } = fakeHost({
      version: "1.2.3",
      spawn: (file, args, options) => (spawned.push({ file, args, options }), fakePty(777)),
    });
    const opened = await host.open({ cwd: "/work", cols: 100, rows: 30, env: { SHELL: "/bin/zsh", PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" } }, sink().handlers);

    expect(opened.pid).toBe(777);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ file: "/bin/zsh", args: [], options: { cwd: "/work", cols: 100, rows: 30, name: "xterm-256color" } });
    const env = spawned[0]!.options.env as Record<string, string>;
    expect(env).toMatchObject({ PATH: "/usr/bin", TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Telar", TERM_PROGRAM_VERSION: "1.2.3" });
    expect("ELECTRON_RUN_AS_NODE" in env).toBe(false);
  });

  test("falls back to /bin/sh and the default grid, and clamps a silly one", async () => {
    const spawned: Array<{ file: string; options: Record<string, unknown> }> = [];
    const { host } = fakeHost({ spawn: (file, _args, options) => (spawned.push({ file, options }), fakePty()) });
    await host.open({ env: {} }, sink().handlers);
    await host.open({ env: {}, cols: 1e9, rows: -4 }, sink().handlers);
    expect(spawned[0]).toMatchObject({ file: "/bin/sh", options: { cols: 80, rows: 24 } });
    expect(spawned[1]!.options).toMatchObject({ cols: 9999, rows: 24 });
  });

  test("a directory that cannot be entered fails the terminal without starting a process", async () => {
    const spawn = jest.fn(() => fakePty());
    const { host } = fakeHost({ spawn, stat: async () => Promise.reject(new Error("ENOENT: no such file or directory")) });
    const opened = await host.open({ cwd: "/gone" }, sink().handlers);

    expect(spawn).not.toHaveBeenCalled();
    expect(opened.pid).toBeUndefined();
    expect(opened.ending).toMatchObject({ fate: "failed", error: expect.stringContaining("Telar cannot start a terminal in /gone") });
  });

  test("a path that is a file is refused with the reason", async () => {
    const { host } = fakeHost({ stat: async () => ({ isDirectory: () => false }) as never });
    const opened = await host.open({ cwd: "/etc/hosts" }, sink().handlers);
    expect(opened.ending?.error).toContain("it exists but is not a directory");
  });

  test("a spawn that throws is a failed terminal, not a rejected open", async () => {
    const { host } = fakeHost({
      spawn: () => {
        throw new Error("posix_spawnp failed.");
      },
    });
    const opened = await host.open({}, sink().handlers);
    expect(opened.ending).toMatchObject({ fate: "failed", error: "posix_spawnp failed." });
    expect(host.size).toBe(0);
  });
});

describe("driving a terminal", () => {
  test("output reaches the sink, input and resizes reach the pty", async () => {
    const { host, ptys } = fakeHost();
    const out = sink();
    const { id } = await host.open({}, out.handlers);
    ptys[0]!.emitData("hello\r\n");
    expect(host.write(id, "ls\r")).toBe(true);
    expect(host.resize(id, 120, 40)).toBe(true);

    expect(out.data).toEqual(["hello\r\n"]);
    expect(ptys[0]!.writes).toEqual(["ls\r"]);
    expect(ptys[0]!.resizes).toEqual([[120, 40]]);
    expect(host.list()[0]).toMatchObject({ id, cols: 120, rows: 40 });
  });

  test("an unknown terminal is refused, never thrown at", () => {
    const { host } = fakeHost();
    expect(host.write("term_x", "a")).toBe(false);
    expect(host.resize("term_x", 1, 1)).toBe(false);
    expect(host.kill("term_x")).toBe(false);
  });

  test("kill signals the whole process group, and a group already gone still counts", async () => {
    const { host, signals } = fakeHost();
    const { id } = await host.open({}, sink().handlers);
    expect(host.kill(id, "SIGINT")).toBe(true);
    expect(signals).toContainEqual([40_000, "SIGINT"]);

    const missing = fakeHost({
      killTree: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
    });
    const second = await missing.host.open({}, sink().handlers);
    expect(missing.host.kill(second.id)).toBe(true);
  });

  test("the process ending is reported once with its status, and the terminal is forgotten", async () => {
    const { host, ptys } = fakeHost();
    const out = sink();
    const { id } = await host.open({ sessionId: "s1" }, out.handlers);
    ptys[0]!.emitExit({ exitCode: 3, signal: 0 });
    ptys[0]!.emitExit({ exitCode: 9 });

    expect(out.endings).toHaveLength(1);
    expect(out.endings[0]).toMatchObject({ id, pid: 40_000, fate: "exited", exitCode: 3 });
    expect(out.endings[0]!.closed).toBeUndefined();
    expect(host.size).toBe(0);
    expect(host.write(id, "x")).toBe(false);
  });

  test("keeps a count of terminals per session", async () => {
    const { host } = fakeHost();
    await host.open({ sessionId: "a" }, sink().handlers);
    await host.open({ sessionId: "a" }, sink().handlers);
    await host.open({ sessionId: "b" }, sink().handlers);
    await host.open({}, sink().handlers);
    expect(host.sessionCounts()).toEqual({ a: 2, b: 1 });
  });
});

describe("closing", () => {
  test("close hangs up the shell, ends it, and records who asked", async () => {
    const { host, signals } = fakeHost();
    const out = sink();
    const { id } = await host.open({}, out.handlers);
    expect(await host.close(id)).toBe(true);

    expect(signals[0]).toEqual([40_000, "SIGHUP"]);
    expect(out.endings[0]).toMatchObject({ fate: "exited", closed: "close" });
    expect(await host.close(id)).toBe(false);
  });

  test("closeSession ends only that session's terminals", async () => {
    const { host } = fakeHost();
    const a = sink();
    const b = sink();
    await host.open({ sessionId: "a" }, a.handlers);
    await host.open({ sessionId: "b" }, b.handlers);
    expect(await host.closeSession("a")).toBe(1);

    expect(a.endings[0]).toMatchObject({ closed: "session" });
    expect(b.endings).toEqual([]);
    expect(host.size).toBe(1);
  });

  test("closeAll records a quit, and dispose refuses any later shell", async () => {
    const { host } = fakeHost();
    const out = sink();
    await host.open({}, out.handlers);
    await host.open({}, out.handlers);
    expect(await host.closeAll()).toBe(2);
    expect(out.endings.map((ending) => ending.closed)).toEqual(["quit", "quit"]);

    await host.dispose();
    await expect(host.open({}, out.handlers)).rejects.toThrow("shutting down");
  });

  test("a process that ignores the polite signal gets SIGKILL after the grace", async () => {
    jest.useFakeTimers();
    try {
      const signals: Array<[number, NodeJS.Signals | 0]> = [];
      const { host } = fakeHost({ closeGraceMs: 1000, killTree: (pid, signal) => void signals.push([pid, signal]) });
      await host.open({}, sink().handlers);
      const closing = host.close((host.list()[0] as { id: string }).id);
      await Promise.resolve();
      await Promise.resolve();
      expect(signals.filter(([, signal]) => signal === "SIGKILL")).toEqual([]);

      jest.advanceTimersByTime(1000);
      await closing;
      expect(signals).toContainEqual([40_000, "SIGKILL"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("every process group under the shell is signalled, not just the shell's", async () => {
    jest.useFakeTimers();
    try {
      const rows = parseProcessTable(["  100   1 100 200 ttys001 -zsh", "  200 100 200 200 ttys001 node server.js", "  300 200 300 200 ttys001 esbuild"].join("\n"));
      const signals: Array<[number, NodeJS.Signals | 0]> = [];
      const { host } = fakeHost({ spawn: () => fakePty(100, "/dev/ttys001"), listProcesses: async () => rows, killTree: (pid, signal) => void signals.push([pid, signal]) });
      const { id } = await host.open({}, sink().handlers);
      const closing = host.close(id);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(signals).toEqual([[100, "SIGHUP"], [100, "SIGTERM"], [200, "SIGTERM"], [300, "SIGTERM"]]);
      jest.advanceTimersByTime(1000);
      await closing;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("closing a session's idle terminals", () => {
  const table = parseProcessTable(["  500   1 500 500 ttys005 -zsh", "  600   1 600 600 ttys006 -zsh", "  610 600 610 610 ttys006 node server.js"].join("\n"));

  async function twoShells() {
    jest.useFakeTimers();
    const ptys = [fakePty(500, "/dev/ttys005"), fakePty(600, "/dev/ttys006")];
    const signals: Array<[number, NodeJS.Signals | 0]> = [];
    let opened = 0;
    const { host } = fakeHost({
      spawn: () => ptys[opened++]!,
      listProcesses: async () => table,
      killTree: (pid, signal) => void signals.push([pid, signal]),
    });
    const idle = (await host.open({ sessionId: "s_1" }, sink().handlers)).id;
    const busy = (await host.open({ sessionId: "s_1" }, sink().handlers)).id;
    return { host, idle, busy, ptys, signals };
  }

  test("an idle shell closes and one running a process stays", async () => {
    try {
      const { host, idle, busy, signals } = await twoShells();
      const closing = host.closeIdle("s_1");
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
      jest.advanceTimersByTime(1000);
      expect(await closing).toEqual([idle]);
      expect(signals.some(([pid]) => pid === 500)).toBe(true);
      expect(host.list().map((terminal) => terminal.id)).toContain(busy);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a shell with input it has not echoed yet stays open", async () => {
    try {
      const { host, idle, ptys, signals } = await twoShells();
      host.write(idle, "make\r");
      expect(await host.closeIdle("s_1")).toEqual([]);
      expect(signals).toEqual([]);
      ptys[0]!.emitData("make\r\n");
      const closing = host.closeIdle("s_1");
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
      jest.advanceTimersByTime(1000);
      expect(await closing).toEqual([idle]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a shell that prints while the process table is read stays open", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pty = fakePty(500, "/dev/ttys005");
    const { host } = fakeHost({ spawn: () => pty, listProcesses: () => gate.then(() => table.slice(0, 1)) });
    await host.open({ sessionId: "s_1" }, sink().handlers);
    const closing = host.closeIdle("s_1");
    pty.emitData("% ");
    release();
    expect(await closing).toEqual([]);
  });

  test("an unreadable process table closes nothing", async () => {
    const { host } = fakeHost({ listProcesses: () => Promise.reject(new Error("ps failed")) });
    await host.open({ sessionId: "s_1" }, sink().handlers);
    expect(await host.closeIdle("s_1")).toEqual([]);
  });
});

describe("what is running in a terminal", () => {
  const rows = parseProcessTable(["  100   1 100 200 ttys001 -zsh", "  200 100 200 200 ttys001 node server.js", "  400   1 400 400 ttys009 unrelated"].join("\n"));

  test("a foreground child makes the terminal active and names its command", async () => {
    const { host } = fakeHost({ spawn: () => fakePty(100, "/dev/ttys001"), listProcesses: async () => rows });
    const { id } = await host.open({ sessionId: "s", origin: "agent", title: "dev" }, sink().handlers);
    expect(await host.active([id])).toEqual([{ id, sessionId: "s", origin: "agent", title: "dev", active: true, processes: 1, command: "node server.js" }]);
  });

  test("an idle shell is not active", async () => {
    const idle = parseProcessTable("  100   1 100 100 ttys001 -zsh");
    const { host } = fakeHost({ spawn: () => fakePty(100, "/dev/ttys001"), listProcesses: async () => idle });
    await host.open({}, sink().handlers);
    expect((await host.active())[0]).toMatchObject({ active: false, processes: 0 });
  });

  test("an unreadable process table is treated as busy rather than as safe to close", async () => {
    const { host } = fakeHost({ listProcesses: () => Promise.reject(new Error("ps failed")) });
    await host.open({}, sink().handlers);
    expect((await host.active())[0]).toMatchObject({ active: true });
  });

  test("terminalProcesses groups include the shell's and every member's", () => {
    expect(terminalProcesses({ pid: 100, tty: "/dev/ttys001" }, rows).groups).toEqual([100, 200]);
  });

  test("the process table parser skips lines it cannot read", () => {
    expect(parseProcessTable("garbage\n  1 0 1 -1 ? launchd\n")).toEqual([{ pid: 1, ppid: 0, pgid: 1, tpgid: -1, tty: "?", command: "launchd" }]);
  });
});

describe("ptyEnv", () => {
  test("keeps a COLORTERM the person set and fills a missing or empty one", () => {
    expect(ptyEnv({ COLORTERM: "24bit" }).COLORTERM).toBe("24bit");
    expect(ptyEnv({ COLORTERM: " " }).COLORTERM).toBe("truecolor");
    expect(ptyEnv({}).COLORTERM).toBe("truecolor");
  });

  test("sets a UTF-8 locale only when the person has none, and takes Telar's own marker back out", () => {
    expect(ptyEnv({}).LANG).toBe("en_US.UTF-8");
    expect(ptyEnv({ LC_CTYPE: "C.UTF-8" }).LANG).toBeUndefined();
    expect(ptyEnv({ LANG: "fr_FR.UTF-8" }).LANG).toBe("fr_FR.UTF-8");
    expect("ELECTRON_RUN_AS_NODE" in ptyEnv({ ELECTRON_RUN_AS_NODE: "1" })).toBe(false);
  });

  test("drops non-strings and omits the version when there is none", () => {
    const env = ptyEnv({ A: "1", B: undefined });
    expect(env.A).toBe("1");
    expect("B" in env).toBe(false);
    expect("TERM_PROGRAM_VERSION" in env).toBe(false);
  });
});

describe("node-pty's spawn-helper", () => {
  function pty(mode: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-pty-"));
    const lib = path.join(dir, "lib");
    fs.mkdirSync(lib);
    const helperDir = path.join(dir, "prebuilds", "darwin-arm64");
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(path.join(helperDir, "spawn-helper"), "", { mode });
    fs.chmodSync(path.join(helperDir, "spawn-helper"), mode);
    return { lib, helper: path.join(helperDir, "spawn-helper") };
  }

  test("is made executable when the tarball left it 0644", () => {
    const { lib, helper } = pty(0o644);
    expect(ensureSpawnHelper(lib, "darwin", "arm64")).toEqual({ path: helper, changed: true });
    expect(fs.statSync(helper).mode & 0o111).not.toBe(0);
    expect(ensureSpawnHelper(lib, "darwin", "arm64")?.changed).toBe(false);
  });

  test("a missing helper names every place it looked", () => {
    const { lib } = pty(0o755);
    expect(() => ensureSpawnHelper(lib, "linux", "arm64")).toThrow("linux-arm64");
    expect(spawnHelperCandidates("/a/app.asar/node_modules/node-pty/lib", "linux", "x64")[0]).toContain("app.asar.unpacked");
  });
});
