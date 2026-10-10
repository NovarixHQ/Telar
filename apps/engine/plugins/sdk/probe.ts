import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ToolInfo = { path: string; version: string };

export type Exec = (file: string, args: string[], options: { cwd?: string; timeoutMs: number }) =>
  Promise<{ status: number; stdout: string; stderr: string }>;

export const defaultExec: Exec = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        const status = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ status, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

const home = () => os.homedir();

const FALLBACK_DIRS: Record<string, () => string[]> = {
  uv: () => [path.join(home(), ".local", "bin"), path.join(home(), ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin"],
  brew: () => ["/opt/homebrew/bin", "/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"],
  conda: () => [
    path.join(home(), "miniforge3", "bin"),
    path.join(home(), "miniconda3", "bin"),
    path.join(home(), "anaconda3", "bin"),
    path.join(home(), "mambaforge", "bin"),
    "/opt/homebrew/Caskroom/miniforge/base/bin",
    "/opt/homebrew/Caskroom/miniconda/base/bin",
    "/opt/miniconda3/bin",
    "/opt/anaconda3/bin",
    "/usr/local/Caskroom/miniforge/base/bin",
  ],
  micromamba: () => [path.join(home(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"],
};

export function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function findBinary(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (executable(candidate)) return candidate;
  }
  for (const dir of FALLBACK_DIRS[name]?.() ?? []) {
    const candidate = path.join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return undefined;
}

export async function toolVersion(exec: Exec, file: string, args: string[] = ["--version"]): Promise<string | undefined> {
  const result = await exec(file, args, { timeoutMs: 10_000 }).catch(() => undefined);
  if (!result || result.status !== 0) return undefined;
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(result.stdout || result.stderr);
  return match?.[1];
}

export async function findBrew(exec: Exec = defaultExec, env = process.env): Promise<ToolInfo | undefined> {
  const file = findBinary("brew", env);
  if (!file) return undefined;
  const found = await toolVersion(exec, file);
  return found ? { path: file, version: found } : undefined;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => Number.parseInt(p, 10));
  const pb = b.split(/[.\-+]/).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (x !== y) return x - y;
  }
  return 0;
}

export function adoptBinaryDir(file: string, env: NodeJS.ProcessEnv = process.env): void {
  const dir = path.dirname(file);
  const entries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (entries.includes(dir)) return;
  env.PATH = [dir, ...entries].join(path.delimiter);
}
