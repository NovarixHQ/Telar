import { spawn } from "node:child_process";
import { mountPointForRoot } from "../fs/volumes";
import { gitChildren, type GitChildren } from "./children";
import { engineGitEnv } from "./env";

export type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
  /** Set when the child was killed for outrunning its bound rather than exiting on its own. */
  timedOut?: true;
  overflowed?: true;
  killedPid?: number;
};
export type GitRunOptions = {
  timeoutMs?: number;
  admissionMs?: number;

  env?: Record<string, string>;
};
export type GitRunner = (cwd: string, args: string[], options?: GitRunOptions) => GitResult;

export const DEFAULT_GIT_TIMEOUT_MS = 30_000;

/** The status a timed-out child reports — coreutils' `timeout` convention. */
export const GIT_TIMEOUT_STATUS = 124;

export const DEFAULT_GIT_ADMISSION_MS = 60_000;

export const STUCK_CHILD_REPORT_MS = 10_000;

export type GitRunnerDeps = {
  /** Which binary to run; `git` from PATH by default. Tests point it at a stalled fake. */
  gitBin?: string;
  defaultTimeoutMs?: number;
  /** How long a call may wait for a slot. */
  defaultAdmissionMs?: number;
  children?: GitChildren;
  spawn?: typeof spawn;
  warn?: (message: string) => void;
};

function gitTimeoutFromEnv(): number {
  const raw = Number(process.env.TELAR_GIT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GIT_TIMEOUT_MS;
}

export type AsyncGitRunner = (cwd: string, args: string[], options?: GitRunOptions) => Promise<GitResult>;

const MAX_GIT_OUTPUT_CHARS = 1024 * 1024;

type Child = ReturnType<typeof spawn>;

function killGroup(child: Child | undefined): number | undefined {
  const pid = child?.pid;
  if (child === undefined || typeof pid !== "number" || pid <= 0) return undefined;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  return pid;
}

const boundOr = (requested: number, fallback: number): number => (Number.isFinite(requested) ? Math.max(1, requested) : fallback);

export function createAsyncGitRunner(deps: GitRunnerDeps & { concurrency?: number } = {}): AsyncGitRunner {
  const requestedLimit = deps.concurrency ?? 4;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.floor(requestedLimit)) : 4;
  const children = deps.children ?? gitChildren;
  const spawnChild = deps.spawn ?? spawn;
  const warn = deps.warn ?? console.warn;
  let active = 0;
  const queue: Array<() => void> = [];
  const admit = (): boolean => {
    if (active >= limit || !children.tryAcquire()) return false;
    active++;
    return true;
  };
  const drain = () => {
    while (queue.length > 0 && admit()) queue.shift()!();
  };
  children.onRelease(drain);

  return (cwd, args, options) => new Promise((resolve) => {
    const timeout = boundOr(options?.timeoutMs ?? deps.defaultTimeoutMs ?? gitTimeoutFromEnv(), DEFAULT_GIT_TIMEOUT_MS);
    const admission = boundOr(options?.admissionMs ?? deps.defaultAdmissionMs ?? DEFAULT_GIT_ADMISSION_MS, DEFAULT_GIT_ADMISSION_MS);
    let settled = false;
    let child: Child | undefined;
    let runTimer: ReturnType<typeof setTimeout> | undefined;
    let stuckTimer: ReturnType<typeof setTimeout> | undefined;
    let admissionTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(admissionTimer);
      clearTimeout(runTimer);
      resolve(result);
    };
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(stuckTimer);
      active--;
      children.release();
      drain();
    };
    const expireAdmission = () => {
      const index = queue.indexOf(start);
      if (index !== -1) queue.splice(index, 1);
      finish({
        status: GIT_TIMEOUT_STATUS,
        stdout: "",
        stderr:
          `git ${args.join(" ")} in ${cwd} waited ${admission}ms for a slot and never started ` +
          `(${children.live()} git processes alive, cap ${children.cap})`,
        timedOut: true,
      });
    };
    const start = () => {
      if (settled) {
        release();
        return;
      }
      clearTimeout(admissionTimer);
      runTimer = setTimeout(() => {
        const killed = killGroup(child);
        stuckTimer = setTimeout(() => {
          warn(`[git] killed git ${args[0] ?? ""} (pid ${killed}) on ${mountPointForRoot(cwd) ?? "the boot volume"} has not exited after ${STUCK_CHILD_REPORT_MS}ms; its slot stays held`);
        }, STUCK_CHILD_REPORT_MS);
        stuckTimer.unref?.();
        finish({
          status: GIT_TIMEOUT_STATUS,
          stdout: "",
          stderr:
            `git ${args.join(" ")} in ${cwd} did not finish within ${timeout}ms and was killed` +
            (killed === undefined ? "" : ` (pid ${killed})`),
          timedOut: true,
          killedPid: killed,
        });
      }, timeout);
      try {
        child = spawnChild(deps.gitBin ?? "git", args, {
          cwd,
          env: engineGitEnv(options?.env),
          // git leads its own process group so the timeout can reap what git spawned.
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        collect(child, args, cwd, release, finish);
      } catch (error) {
        release();
        finish({ status: 1, stdout: "", stderr: String(error) });
      }
    };
    if (admit()) start();
    else {
      queue.push(start);
      admissionTimer = setTimeout(expireAdmission, admission);
    }
  });
}

/** The slot is released only when the child has exited; a killed child stuck in I/O keeps it. */
function collect(child: Child, args: string[], cwd: string, release: () => void, finish: (result: GitResult) => void): void {
  let stdout = "";
  let stderr = "";
  let overflowed = false;
  const append = (into: "stdout" | "stderr") => (chunk: string) => {
    if (overflowed) return;
    if ((into === "stdout" ? stdout : stderr).length + chunk.length > MAX_GIT_OUTPUT_CHARS) {
      overflowed = true;
      killGroup(child);
      return;
    }
    if (into === "stdout") stdout += chunk;
    else stderr += chunk;
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", append("stdout"));
  child.stderr?.on("data", append("stderr"));
  child.on("error", (error) => {
    if (child.pid === undefined) release();
    finish({ status: 1, stdout, stderr: stderr || String(error) });
  });
  child.on("exit", release);
  child.on("close", (code) => {
    release();
    if (overflowed) {
      finish({ status: 1, stdout, stderr: `git ${args.join(" ")} in ${cwd} wrote more than ${MAX_GIT_OUTPUT_CHARS} characters`, overflowed: true });
      return;
    }
    finish({ status: code ?? 1, stdout, stderr });
  });
}

export const defaultAsyncGitRunner: AsyncGitRunner = createAsyncGitRunner();
