import { afterAll, afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunManager } from "./manager";
import { type StartRunInput } from "./live-run";
import type { RunLaunchEvents, RunLaunchRequest, RunLauncher } from "./launcher";
import type { RunConfiguration, RunEnvVar } from "./types";

const worktree = () => track(fs.mkdtempSync(path.join(os.tmpdir(), "telar-run-tree-")));

const track = (dir: string): string => (tempDirs.push(dir), dir);
const managers: RunManager[] = [];
const tempDirs: string[] = [];

function runManager(...args: ConstructorParameters<typeof RunManager>): RunManager {
  const manager = new RunManager(...args);
  managers.push(manager);
  return manager;
}

afterEach(async () => {
  while (managers.length) {
    try {
      await managers.pop()!.shutdown();
    } catch {
    }
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function config(command: string, extra: Partial<RunConfiguration> = {}): RunConfiguration {
  return {
    id: "runcfg_test",
    projectId: "proj_1",
    name: "fixture",
    command,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function input(tree: string, cfg: RunConfiguration, extra: Partial<StartRunInput> = {}): StartRunInput {
  return { projectId: "proj_1", config: cfg, worktreePath: tree, sessionId: "sess_a", ...extra };
}

async function until(predicate: () => boolean, ms = 6_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("a watcher is told every transition, with the whole view and the session it belongs to", async () => {
  const manager = runManager();
  const seen: Array<{ status: string; terminalId: string; sessionId: string }> = [];
  const stop = manager.watch((event) => {
    expect(event.type).toBe("run.status");
    expect(event.projectId).toBe("proj_1");
    seen.push({ status: event.run.status, terminalId: event.run.terminalId, sessionId: event.sessionId });
  });

  const tree = worktree();
  const started = await manager.start(input(tree, config("exit 0")));
  expect(await until(() => seen.some((frame) => frame.status === "exited"))).toBe(true);

  expect(seen[0]).toEqual({ status: "running", terminalId: started.terminalId, sessionId: "sess_a" });
  expect(seen[seen.length - 1]!.status).toBe("exited");

  stop();
  const before = seen.length;
  await manager.start(input(tree, config("exit 0", { id: "runcfg_two" })));
  expect(seen.length).toBe(before);
});

test("a run lands in the configured directory with the configured environment, and its output is kept after it finishes", async () => {
  const tree = worktree();
  fs.mkdirSync(path.join(tree, "apps", "web"), { recursive: true });
  const manager = runManager();

  const started = await manager.start(
    input(tree, config('pwd; echo "greeting=$GREETING"', { cwd: "apps/web", env: [{ key: "GREETING", value: "hello" }] })),
  );
  expect(started.cwd).toBe(path.join(tree, "apps", "web"));
  expect(started.worktreePath).toBe(tree);
  expect(started.sessionId).toBe("sess_a");
  expect(started.origin).toBe("run");
  expect(started.terminalId).toMatch(/^pipe_/);
  expect(started.runId).toBe(started.terminalId);

  expect(await until(() => manager.run(started.runId).activity === "idle")).toBe(true);
  expect(manager.run(started.runId).lastExit?.exitCode).toBe(0);

  const output = manager.output(started.runId);
  const text = output.lines.map((line) => line.text).join("\n");
  expect(text).toContain("greeting=hello");
  expect(fs.realpathSync(text.split("\n")[0]!)).toBe(fs.realpathSync(path.join(tree, "apps", "web")));
  expect(output.cursor).toBe(output.lines.length);
}, 10_000);

test("a terminal does not inherit the engine's store, host token or desktop control channel", async () => {
  const names = ["TELAR_HOME", "ELECTRON_RUN_AS_NODE", "TELAR_HOST_TOKEN", "TELAR_DESKTOP_BROWSER_CONTROL_PORT", "TELAR_DESKTOP_BROWSER_CONTROL_TOKEN"];
  const saved = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) process.env[name] = "engine-only";
  let seen: NodeJS.ProcessEnv | undefined;
  const launcher: RunLauncher = {
    kind: "pipes",
    launch: async (request) => {
      seen = request.env;
      throw new Error("captured");
    },
  };
  try {
    await runManager({ launcher }).start(input(worktree(), config("true", { env: [{ key: "GREETING", value: "hello" }] }))).catch(() => undefined);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  for (const name of names) expect(seen).not.toHaveProperty(name);
  expect(seen?.PATH).toBe(process.env.PATH);
  expect(seen?.HOME).toBe(process.env.HOME);
  expect(seen?.GREETING).toBe("hello");
});

test("a non-zero exit is a failure, with the code kept", async () => {
  const manager = runManager();
  const run = await manager.start(input(worktree(), config("echo nope >&2; exit 3")));
  expect(await until(() => manager.run(run.runId).status === "failed")).toBe(true);
  const finished = manager.run(run.runId);
  expect(finished.exitCode).toBe(3);
  expect(manager.output(run.runId).lines.some((line) => line.stream === "stderr" && line.text === "nope")).toBe(true);
}, 10_000);

test("a secret env value reaches the process but never the captured output or the view", async () => {
  const manager = runManager();
  const secret: RunEnvVar = { key: "TOKEN", value: "sk_live_do_not_print", secret: true };
  const run = await manager.start(input(worktree(), config('echo "token is $TOKEN"', { env: [secret] })));

  expect(await until(() => manager.run(run.runId).activity === "idle")).toBe(true);
  const text = manager.output(run.runId).lines.map((line) => line.text).join("\n");
  expect(text).toContain("token is «redacted»");
  expect(text).not.toContain("sk_live_do_not_print");
  expect(JSON.stringify(manager.run(run.runId))).not.toContain("sk_live_do_not_print");
}, 10_000);

test("a working directory outside the worktree, or one that does not exist, is refused before anything spawns", async () => {
  const manager = runManager();
  const tree = worktree();
  await expect(manager.start(input(tree, config("ls", { cwd: "../.." })))).rejects.toThrow(/outside the worktree/);
  await expect(manager.start(input(tree, config("ls", { cwd: "nope" })))).rejects.toThrow(/no directory/);
  expect(manager.terminals("sess_a")).toEqual([]);
});

test("closing takes the whole process group, so a background child does not survive it", async () => {
  const tree = worktree();
  const manager = runManager();
  const run = await manager.start(input(tree, config("sleep 30 & echo $! > child.pid; wait")));

  const pidFile = path.join(tree, "child.pid");
  expect(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim().length > 0)).toBe(true);
  const childPid = Number(fs.readFileSync(pidFile, "utf8").trim());
  expect(alive(childPid)).toBe(true);

  const closed = await manager.close(run.terminalId, "person");
  expect(closed.status).toBe("closed");
  expect(closed.closedBy).toBe("person");
  expect(await until(() => !alive(childPid))).toBe(true);
}, 15_000);

test("a shell that ignores SIGTERM and keeps working is killed outright, and the terminal still closes", async () => {
  const manager = runManager({ stopGraceMs: 500 });
  const run = await manager.start(input(worktree(), config("trap '' TERM; echo trapped; while :; do sleep 1; done")));
  expect(await until(() => manager.output(run.terminalId).lines.some((line) => line.text === "trapped"))).toBe(true);

  const before = Date.now();
  const closed = await manager.close(run.terminalId, "agent");
  expect(Date.now() - before).toBeGreaterThanOrEqual(500);
  expect(closed.status).toBe("closed");
  expect(closed.closedBy).toBe("agent");
  expect(closed.signal).toBe("SIGKILL");
}, 15_000);

test("restart closes the terminal and opens the same recipe on the same tree in a new one", async () => {
  const tree = worktree();
  const manager = runManager();
  const first = await manager.start(input(tree, config("sleep 30")));
  const second = await manager.restart(first.terminalId, "agent");

  expect(second.terminalId).not.toBe(first.terminalId);
  expect(second.command).toBe("sleep 30");
  expect(second.worktreePath).toBe(tree);
  expect(second.status).toBe("running");
  expect(manager.run(first.terminalId).status).toBe("closed");
  expect(manager.run(first.terminalId).closedBy).toBe("agent");
  expect(second.title).toBe("fixture");

  await manager.close(second.terminalId, "person");
}, 15_000);

test("the pipe fallback opens two instances of one recipe, and closing one leaves the other", async () => {
  const tree = worktree();
  const manager = runManager();
  const [first, second] = await Promise.all([manager.start(input(tree, config("sleep 30"))), manager.start(input(tree, config("sleep 30")))]);

  expect(first!.terminalId).not.toBe(second!.terminalId);
  expect([first!.title, second!.title].sort()).toEqual(["fixture", "fixture #2"]);
  expect(first!.status).toBe("running");
  expect(second!.status).toBe("running");
  expect(alive(first!.pid!)).toBe(true);
  expect(alive(second!.pid!)).toBe(true);

  await manager.close(first!.terminalId, "person");
  expect(await until(() => !alive(first!.pid!))).toBe(true);
  expect(alive(second!.pid!)).toBe(true);
  expect(manager.run(second!.terminalId).status).toBe("running");
  expect(manager.terminals("sess_a").map((run) => run.terminalId).sort()).toEqual([first!.terminalId, second!.terminalId].sort());
}, 15_000);

test("shutdown closes the pipe fallback's children rather than leaving orphans nothing could reach", async () => {
  const manager = runManager();
  const run = await manager.start(input(worktree(), config("sleep 30")));
  const pid = manager.run(run.terminalId).pid!;
  expect(alive(pid)).toBe(true);

  await manager.shutdown();
  expect(await until(() => !alive(pid))).toBe(true);
  expect(manager.run(run.terminalId).status).toBe("closed");
  expect(manager.run(run.terminalId).closedBy).toBe("telar");
}, 15_000);

const PROMPT = "\x1b]133;A\x07% ";
const finished = (code: number) => `\x1b]133;D;${code}\x07${PROMPT}`;

function fakeShell() {
  const writes: string[] = [];
  const requests: RunLaunchRequest[] = [];
  const events = new Map<string, RunLaunchEvents>();
  const launcher: RunLauncher = {
    kind: "pty",
    async launch(request, sink) {
      requests.push(request);
      const terminalId = `term_${requests.length}`;
      events.set(terminalId, sink);
      return {
        pid: 40_000 + requests.length,
        terminalId,
        close: async () => sink.exited({ exitCode: 0, closed: "close" }),
        signal: async () => {},
        write: async (data) => (writes.push(data), true),
        resize: async () => true,
      };
    },
  };
  return { launcher, writes, requests, print: (terminalId: string, text: string) => events.get(terminalId)!.output("stdout", text) };
}

function shellManager(shell = fakeShell()) {
  const manager = runManager({ launcher: shell.launcher, platform: "darwin", env: { SHELL: "/bin/zsh" }, shellDir: worktree() });
  return { manager, shell };
}

test("a terminal is the person's login shell, the command is typed at its first prompt, and the shell outlives it", async () => {
  const { manager, shell } = shellManager();
  const run = await manager.start(input(worktree(), config("bun test")));

  expect(shell.requests[0]!.file).toBe("/bin/zsh");
  expect(shell.requests[0]!.args).toEqual(["-l", "-i"]);
  expect(run.activity).toBe("busy");
  expect(shell.writes).toEqual([]);

  shell.print(run.terminalId, PROMPT);
  expect(shell.writes).toEqual(["bun test\r"]);

  shell.print(run.terminalId, `bun test\r\n3 pass\r\n${finished(0)}`);
  const after = manager.run(run.terminalId);
  expect(after.status).toBe("running");
  expect(after.activity).toBe("idle");
  expect(after.lastExit?.exitCode).toBe(0);
  const lines = manager.output(run.terminalId).lines.map((line) => line.text);
  expect(lines).toContain("3 pass");
  expect(lines.join("\n")).not.toContain("133;");
});

test("waiting for exit answers the command's exit code while the shell stays open", async () => {
  const { manager, shell } = shellManager();
  const run = await manager.start(input(worktree(), config("bun run build")));
  shell.print(run.terminalId, PROMPT);

  const waiting = manager.wait(run.terminalId, { exit: true, timeoutMs: 5_000 });
  shell.print(run.terminalId, `bun run build\r\nerror: build failed\r\n${finished(2)}`);
  const answer = await waiting;

  expect(answer.fired).toBe("finished");
  expect(answer.exitCode).toBe(2);
  expect(answer.lines.map((line) => line.text)).toContain("error: build failed");
  expect(manager.run(run.terminalId).status).toBe("running");
});

test("a command is typed into an idle terminal, and refused while the last one still runs", async () => {
  const { manager, shell } = shellManager();
  const run = await manager.start(input(worktree(), config("bun run dev")));
  shell.print(run.terminalId, PROMPT);

  expect(() => manager.command(run.terminalId, "bun test")).toThrow(/still running "bun run dev"/);
  shell.print(run.terminalId, finished(130));

  const next = manager.command(run.terminalId, "bun test");
  expect(next.terminalId).toBe(run.terminalId);
  expect(next.activity).toBe("busy");
  expect(next.command).toBe("bun test");
  expect(shell.writes.at(-1)).toBe("bun test\r");
  expect(shell.requests).toHaveLength(1);
});

test("starting a configuration reuses its idle terminal, and opens another while that one is busy", async () => {
  const { manager, shell } = shellManager();
  const tree = worktree();
  const first = await manager.start(input(tree, config("bun run dev")));
  shell.print(first.terminalId, PROMPT);

  const busy = await manager.start(input(tree, config("bun run dev")));
  expect(busy.terminalId).not.toBe(first.terminalId);
  expect(busy.title).toBe("fixture #2");

  shell.print(first.terminalId, finished(0));
  const reused = await manager.start(input(tree, config("bun run dev")));
  expect(reused.terminalId).toBe(first.terminalId);
  expect(shell.requests).toHaveLength(2);
  expect(shell.writes.filter((text) => text === "bun run dev\r")).toHaveLength(2);
});

test("restart interrupts the running command and types it again in the same shell", async () => {
  const { manager, shell } = shellManager();
  const run = await manager.start(input(worktree(), config("bun run dev")));
  shell.print(run.terminalId, PROMPT);

  const restarting = manager.restart(run.terminalId);
  expect(shell.writes.at(-1)).toBe("\x03");
  shell.print(run.terminalId, `^C\r\n${finished(130)}`);
  const again = await restarting;

  expect(again.terminalId).toBe(run.terminalId);
  expect(again.activity).toBe("busy");
  expect(shell.writes.at(-1)).toBe("bun run dev\r");
  expect(manager.run(run.terminalId).status).toBe("running");
});

test("a shell whose hooks never draw a prompt is typed into anyway, with a sentinel that marks the finish", async () => {
  const shell = fakeShell();
  const manager = runManager({ launcher: shell.launcher, platform: "darwin", env: { SHELL: "/bin/zsh" }, shellDir: worktree(), promptWaitMs: 0 });
  const run = await manager.start(input(worktree(), config("make")));

  expect(await until(() => shell.writes.length > 0)).toBe(true);
  expect(shell.writes[0]).toBe("make\rprintf '\\033]133;D;%s\\007' \"$?\"\r");
  shell.print(run.terminalId, `done\r\n\x1b]133;D;0\x07`);
  expect(manager.run(run.terminalId).activity).toBe("idle");
});

test("without a terminal host the shell still survives its command and takes the next one", async () => {
  const manager = runManager();
  const run = await manager.start(input(worktree(), config("echo first; false")));
  expect(await until(() => manager.run(run.terminalId).activity === "idle")).toBe(true);
  expect(manager.run(run.terminalId).lastExit?.exitCode).toBe(1);

  manager.command(run.terminalId, "echo second");
  expect(await until(() => manager.run(run.terminalId).activity === "idle")).toBe(true);
  const after = manager.run(run.terminalId);
  expect(after.status).toBe("running");
  expect(after.pid).toBe(run.pid);
  expect(manager.output(run.terminalId).lines.map((line) => line.text)).toEqual(["first", "second"]);
}, 10_000);
