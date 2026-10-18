import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { engineRootFor } from "@telar/engine/headless";
import type { Io } from "./io";
import { UsageError } from "./io";
import { readServeInfo, removeServeInfo, type ServeInfo } from "./link";
import { currentVersion, downloadBase, installRelease, pruneVersions, resolveVersion, switchCurrent, versionDir, type Channel } from "./runtime";
import { defaultContext, logFile, restartService, runtimeDir, serviceInstalled, stopService, type ServiceContext } from "./service";

export type Trial = { exited: Promise<void>; stop(): Promise<void> };

export type UpdateOps = {
  wasRunning(): boolean;
  stopEngine(): Promise<void>;
  startEngine(): Promise<void>;
  startTrial(binary: string): Trial;
  ping(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  snapshot(): string;
  restore(snapshot: string): void;
  log(line: string): void;
};

export type UpdateResult = "committed" | "rolled-back";
export type UpdatePlan = { runtime: string; from: string; to: string };

const POLL_MS = 1_000;
const SETTLE_MS = 3_000;
const HEALTH_TIMEOUT_MS = 60_000;

async function waitHealthy(trial: Trial, ops: Pick<UpdateOps, "ping" | "sleep">): Promise<boolean> {
  const exitedFirst = (ms: number) => Promise.race([trial.exited.then(() => true), ops.sleep(ms).then(() => false)]);
  for (let waited = 0; waited < HEALTH_TIMEOUT_MS; waited += POLL_MS) {
    if (await ops.ping()) return !(await exitedFirst(SETTLE_MS));
    if (await exitedFirst(POLL_MS)) return false;
  }
  return false;
}

export async function applyUpdate(plan: UpdatePlan, ops: UpdateOps): Promise<UpdateResult> {
  const running = ops.wasRunning();
  await ops.stopEngine();
  const snapshot = ops.snapshot();
  ops.log(`Trying ${plan.to} (snapshot ${snapshot})`);
  const trial = ops.startTrial(path.join(versionDir(plan.runtime, plan.to), "telar"));
  const healthy = await waitHealthy(trial, ops);
  await trial.stop();
  if (healthy) {
    switchCurrent(plan.runtime, plan.to);
    if (!running) return "committed";
    await ops.startEngine();
    if (await waitHealthy({ exited: new Promise(() => undefined), stop: async () => undefined }, ops)) {
      pruneVersions(plan.runtime, [plan.from, plan.to]);
      return "committed";
    }
    ops.log(`${plan.to} failed after the switch`);
    await ops.stopEngine();
    switchCurrent(plan.runtime, plan.from);
  } else {
    ops.log(`${plan.to} did not become healthy`);
  }
  ops.restore(snapshot);
  if (running) await ops.startEngine();
  return "rolled-back";
}

export function snapshotStore(home: string, from: string, now = Date.now()): string {
  const root = engineRootFor(home);
  const dir = path.join(home, "backups", `pre-update-${from}-${now}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) if (/\.sqlite(-wal|-shm)?$/.test(name)) fs.copyFileSync(path.join(root, name), path.join(dir, name));
  const olds = fs.readdirSync(path.join(home, "backups")).filter((name) => name.startsWith("pre-update-")).sort();
  for (const name of olds.slice(0, -3)) fs.rmSync(path.join(home, "backups", name), { recursive: true, force: true });
  return dir;
}

export function restoreStore(home: string, snapshot: string): void {
  const root = engineRootFor(home);
  for (const name of fs.readdirSync(root)) if (/\.sqlite(-wal|-shm)?$/.test(name)) fs.rmSync(path.join(root, name), { force: true });
  for (const name of fs.readdirSync(snapshot)) fs.copyFileSync(path.join(snapshot, name), path.join(root, name));
}

function lockPid(home: string): number | undefined {
  try {
    const pid = (JSON.parse(fs.readFileSync(path.join(engineRootFor(home), "engine.lock"), "utf8")) as { pid?: number }).pid;
    return typeof pid === "number" ? pid : undefined;
  } catch {
    return undefined;
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const settle = (child: ChildProcess): Promise<void> => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", () => resolve())));

function serveArgs(home: string, info: ServeInfo | undefined): string[] {
  return ["serve", "--home", home, "--host", info?.host ?? "127.0.0.1", "--port", String(info?.port ?? 7420), ...(info?.tailscale ? ["--tailscale-serve"] : [])];
}

function realOps(ctx: ServiceContext, log: (line: string) => void): UpdateOps {
  const home = ctx.home;
  const before = readServeInfo(home);
  const pid = lockPid(home);
  const viaService = serviceInstalled(ctx);
  const running = pid !== undefined && alive(pid);
  const bareStart = (binary: string): ChildProcess => {
    fs.mkdirSync(path.dirname(logFile(home)), { recursive: true });
    const fd = fs.openSync(logFile(home), "a");
    return spawn(binary, serveArgs(home, before), { stdio: ["ignore", fd, fd], detached: true });
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  return {
    wasRunning: () => running,
    async stopEngine() {
      if (!running) return;
      if (viaService) await stopService(ctx);
      else if (pid !== undefined) process.kill(pid, "SIGTERM");
      for (let waited = 0; pid !== undefined && alive(pid) && waited < 30_000; waited += 250) await sleep(250);
    },
    async startEngine() {
      if (viaService) await restartService(ctx, { out: () => undefined, err: () => undefined });
      else bareStart(path.join(runtimeDir(ctx.env, ctx.userHome), "current", "telar")).unref();
    },
    startTrial(binary) {
      removeServeInfo(home);
      const child = bareStart(binary);
      return {
        exited: settle(child),
        async stop() {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
          await Promise.race([settle(child), sleep(15_000)]);
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          await settle(child);
        },
      };
    },
    async ping() {
      const info = readServeInfo(home);
      if (!info) return false;
      try {
        return (await fetch(`http://${info.host === "0.0.0.0" || info.host === "::" ? "127.0.0.1" : info.host}:${info.port}/v2/ping`)).ok;
      } catch {
        return false;
      }
    },
    sleep,
    snapshot: () => snapshotStore(home, currentVersion(runtimeDir(ctx.env, ctx.userHome)) ?? "unknown"),
    restore: (snapshot) => restoreStore(home, snapshot),
    log,
  };
}

export type UpdateOptions = { home: string; channel: Channel; version?: string; base?: string; apply: boolean };

const statusFile = (home: string): string => path.join(home, "update.json");
type Status = { state: "running" | UpdateResult | "failed"; from: string; to: string; message?: string };
const writeStatus = (home: string, status: Status): void => fs.writeFileSync(statusFile(home), JSON.stringify(status));
const readStatus = (home: string): Status | undefined => {
  try {
    return JSON.parse(fs.readFileSync(statusFile(home), "utf8")) as Status;
  } catch {
    return undefined;
  }
};

async function runApply(options: UpdateOptions, ctx: ServiceContext): Promise<number> {
  const runtime = runtimeDir(ctx.env, ctx.userHome);
  const from = currentVersion(runtime);
  const to = options.version;
  if (!from || !to) throw new UsageError("The updater needs an installed version and a target.");
  const log = (line: string) => fs.appendFileSync(path.join(options.home, "update.log"), `${new Date().toISOString()} ${line}\n`);
  writeStatus(options.home, { state: "running", from, to });
  try {
    const result = await applyUpdate({ runtime, from, to }, realOps(ctx, log));
    writeStatus(options.home, { state: result, from, to });
    return result === "committed" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`failed: ${message}`);
    writeStatus(options.home, { state: "failed", from, to, message });
    return 1;
  }
}

function detach(ctx: ServiceContext, to: string, home: string): void {
  const args = ["update", "--apply", "--version", to, "--home", home];
  fs.mkdirSync(home, { recursive: true });
  const fd = fs.openSync(path.join(home, "update.log"), "a");
  const direct = () => void spawn(process.execPath, args, { detached: true, stdio: ["ignore", fd, fd], env: ctx.env }).unref();
  if (ctx.platform === "linux" && serviceInstalled(ctx)) {
    const env = ctx.env.TELAR_RUNTIME ? [`--setenv=TELAR_RUNTIME=${ctx.env.TELAR_RUNTIME}`] : [];
    const unit = execFile("systemd-run", ["--user", "--collect", "--quiet", `--unit=telar-update-${Date.now()}`, ...env, process.execPath, ...args]);
    unit.on("error", () => direct());
    return;
  }
  direct();
}

export async function update(options: UpdateOptions, io: Io, ctx = defaultContext(options.home)): Promise<number> {
  if (options.apply) return runApply(options, ctx);
  const runtime = runtimeDir(ctx.env, ctx.userHome);
  const from = currentVersion(runtime);
  if (!from) throw new UsageError("This telar was not installed with install.sh, so it cannot update itself.");
  const base = downloadBase(options.base, ctx.env);
  const to = await resolveVersion(base, options.channel, options.version);
  if (to === from) {
    io.out(`Already on ${from}.`);
    return 0;
  }
  io.out(`Downloading ${to}…`);
  await installRelease(runtime, base, to);
  fs.rmSync(statusFile(options.home), { force: true });
  detach(ctx, to, options.home);
  io.out(`Updating ${from} → ${to} in the background (log: ${path.join(options.home, "update.log")}).`);
  for (let waited = 0; waited < 180_000; waited += 1_000) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const status = readStatus(options.home);
    if (status && status.state !== "running") {
      io.out(status.state === "committed" ? `Updated to ${to}.` : `Update ${status.state}; still on ${from}.${status.message ? ` ${status.message}` : ""}`);
      return status.state === "committed" ? 0 : 1;
    }
  }
  io.out("Still updating; check `update.log` in the data directory.");
  return 0;
}
