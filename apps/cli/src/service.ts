import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Io } from "./io";
import { UsageError } from "./io";
import { LAUNCHD_LABEL, SYSTEMD_UNIT, launchdPlist, systemdUnit, type ServiceSpec } from "./service-unit";

export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const execCommand: Exec = (file, args) =>
  new Promise((resolve) =>
    execFile(file, args, { encoding: "utf8", timeout: 30_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr: error && !stderr ? error.message : stderr }),
    ),
  );

export type ServiceContext = { home: string; userHome: string; platform: NodeJS.Platform; uid: number; user: string; exec: Exec; env: NodeJS.ProcessEnv };

export const defaultContext = (home: string): ServiceContext => ({
  home,
  userHome: os.homedir(),
  platform: process.platform,
  uid: process.getuid?.() ?? 0,
  user: os.userInfo().username,
  exec: execCommand,
  env: process.env,
});

export type ServeFlags = { host: string; port: number; tailscaleServe: boolean };

export const runtimeDir = (env: NodeJS.ProcessEnv, userHome: string): string => env.TELAR_RUNTIME?.trim() || path.join(userHome, ".telar", "runtime");

export function serviceCommand(ctx: ServiceContext, flags: ServeFlags, exe = process.execPath, script = process.argv[1]): string[] {
  const runtime = runtimeDir(ctx.env, ctx.userHome);
  const scripted = /^(node|bun)(\.exe)?$/.test(path.basename(exe));
  const base = exe.startsWith(`${path.join(runtime, "versions")}${path.sep}`) ? [path.join(runtime, "current", path.basename(exe))] : scripted && script ? [exe, script] : [exe];
  return [...base, "serve", "--home", ctx.home, "--host", flags.host, "--port", String(flags.port), ...(flags.tailscaleServe ? ["--tailscale-serve"] : [])];
}

const unitFile = (ctx: ServiceContext): string =>
  ctx.platform === "darwin"
    ? path.join(ctx.userHome, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
    : path.join(ctx.env.XDG_CONFIG_HOME?.trim() || path.join(ctx.userHome, ".config"), "systemd", "user", SYSTEMD_UNIT);

export const logFile = (home: string): string => path.join(home, "logs", "engine.log");

async function must(ctx: ServiceContext, file: string, args: string[]): Promise<string> {
  const done = await ctx.exec(file, args);
  if (done.code !== 0) throw new Error(`${file} ${args.join(" ")} failed: ${(done.stderr || done.stdout).trim()}`);
  return done.stdout;
}

const launchTarget = (ctx: ServiceContext): string => `gui/${ctx.uid}/${LAUNCHD_LABEL}`;

export async function installService(ctx: ServiceContext, flags: ServeFlags, io: Io, command = serviceCommand(ctx, flags)): Promise<void> {
  if (ctx.platform !== "linux" && ctx.platform !== "darwin") throw new UsageError("`telar service` supports Linux (systemd) and macOS (launchd).");
  const spec: ServiceSpec = { command, home: ctx.home, logFile: logFile(ctx.home) };
  const file = unitFile(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (ctx.platform === "darwin") {
    fs.mkdirSync(path.dirname(spec.logFile), { recursive: true });
    fs.writeFileSync(file, launchdPlist(spec));
    await ctx.exec("launchctl", ["bootout", `gui/${ctx.uid}`, file]);
    await must(ctx, "launchctl", ["bootstrap", `gui/${ctx.uid}`, file]);
    io.out(`Installed ${file}. Logs: ${spec.logFile}`);
    return;
  }
  fs.writeFileSync(file, systemdUnit(spec));
  await must(ctx, "systemctl", ["--user", "daemon-reload"]);
  await must(ctx, "systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT]);
  const linger = await ctx.exec("loginctl", ["enable-linger", ctx.user]);
  io.out(`Installed ${file}. Logs: journalctl --user -u ${SYSTEMD_UNIT} -f`);
  if (linger.code !== 0) io.err(`Could not enable linger (${linger.stderr.trim()}); the service stops when you log out. Run: sudo loginctl enable-linger ${ctx.user}`);
}

export async function serviceStatus(ctx: ServiceContext, io: Io): Promise<number> {
  if (!fs.existsSync(unitFile(ctx))) {
    io.out("Not installed. Run `telar service install`.");
    return 3;
  }
  const done =
    ctx.platform === "darwin" ? await ctx.exec("launchctl", ["print", launchTarget(ctx)]) : await ctx.exec("systemctl", ["--user", "status", SYSTEMD_UNIT, "--no-pager"]);
  io.out(done.stdout.trimEnd() || done.stderr.trimEnd());
  io.out(ctx.platform === "darwin" ? `Logs: ${logFile(ctx.home)}` : `Logs: journalctl --user -u ${SYSTEMD_UNIT} -f`);
  return done.code === 0 ? 0 : 3;
}

export const serviceInstalled = (ctx: ServiceContext): boolean => fs.existsSync(unitFile(ctx));

export async function stopService(ctx: ServiceContext): Promise<void> {
  if (ctx.platform === "darwin") await must(ctx, "launchctl", ["kill", "SIGTERM", launchTarget(ctx)]);
  else await must(ctx, "systemctl", ["--user", "stop", SYSTEMD_UNIT]);
}

export async function restartService(ctx: ServiceContext, io: Io): Promise<void> {
  if (!serviceInstalled(ctx)) throw new UsageError("Not installed. Run `telar service install`.");
  if (ctx.platform === "darwin") await must(ctx, "launchctl", ["kickstart", "-k", launchTarget(ctx)]);
  else await must(ctx, "systemctl", ["--user", "restart", SYSTEMD_UNIT]);
  io.out("Restarted.");
}

export async function uninstallService(ctx: ServiceContext, io: Io): Promise<void> {
  const file = unitFile(ctx);
  if (ctx.platform === "darwin") await ctx.exec("launchctl", ["bootout", `gui/${ctx.uid}`, file]);
  else await ctx.exec("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT]);
  fs.rmSync(file, { force: true });
  if (ctx.platform === "linux") await ctx.exec("systemctl", ["--user", "daemon-reload"]);
  io.out("Uninstalled. Linger, if enabled, is left on; turn it off with `loginctl disable-linger`.");
}
