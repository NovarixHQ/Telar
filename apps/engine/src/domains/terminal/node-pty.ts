import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export type PtyProcess = {
  pid: number;
  ptsName?: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  on?(event: "error", handler: (error: Error) => void): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (ending: { exitCode?: number; signal?: number | string }) => void): void;
};

export type PtySpawn = (file: string, args: string[], options: { name: string; cols: number; rows: number; cwd?: string; env: Record<string, string> }) => PtyProcess;

const require = createRequire(import.meta.url);

export function spawnHelperCandidates(libDir: string, platform: string, arch: string): string[] {
  const paths: string[] = [];
  for (const build of ["build/Release", "build/Debug", `prebuilds/${platform}-${arch}`]) {
    for (const root of ["..", "."]) {
      paths.push(path.resolve(libDir, root, build, "spawn-helper").replace("app.asar", "app.asar.unpacked").replace("node_modules.asar", "node_modules.asar.unpacked"));
    }
  }
  return paths;
}

export function ensureSpawnHelper(libDir: string, platform = process.platform, arch = process.arch): { path: string; changed: boolean } | null {
  if (platform !== "darwin") return null;
  const candidates = spawnHelperCandidates(libDir, platform, arch);
  const helper = candidates.find((candidate) => fs.existsSync(candidate));
  if (!helper) throw new Error(`node-pty has no spawn-helper for ${platform}-${arch}. Looked in: ${candidates.join(", ")}.`);
  const mode = fs.statSync(helper).mode;
  if ((mode & 0o111) !== 0) return { path: helper, changed: false };
  try {
    fs.chmodSync(helper, (mode & 0o7777) | 0o755);
  } catch (error) {
    throw new Error(`Telar could not make node-pty's spawn-helper executable at ${helper}: ${error instanceof Error ? error.message : String(error)}.`);
  }
  return { path: helper, changed: true };
}

export function nodePtySpawner(): PtySpawn {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    throw new Error("Terminals need the engine running on Node; node-pty does not work under Bun.");
  }
  const pty = require("node-pty") as { spawn: PtySpawn };
  ensureSpawnHelper(path.dirname(require.resolve("node-pty")));
  return (file, args, options) => pty.spawn(file, args, options);
}
