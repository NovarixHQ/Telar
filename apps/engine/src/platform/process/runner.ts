import { spawn } from "node:child_process";
import { OWN_GROUP, stopGroup } from "./group";

export type ProcessOptions = { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number };
export type ProcessResult = { code: number | null; stdout: string; stderr: string };

export type ProcessHandle = {
  pid: number | undefined;
  exited: Promise<number | null>;
  stop(): void;
};

export type ProcessRunner = {
  run(file: string, args: readonly string[], options?: ProcessOptions): Promise<ProcessResult>;
  start(file: string, args: readonly string[], options?: Omit<ProcessOptions, "timeoutMs">): ProcessHandle;
};

const OUTPUT_LIMIT = 4_000_000;

export const processRunner: ProcessRunner = {
  run(file, args, options = {}) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, detached: OWN_GROUP, stdio: ["ignore", "pipe", "pipe"] });
      const timer = options.timeoutMs ? setTimeout(() => stopGroup(child, 500), options.timeoutMs) : undefined;
      child.stdout.on("data", (chunk: Buffer) => (stdout = (stdout + chunk.toString("utf8")).slice(-OUTPUT_LIMIT)));
      child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-OUTPUT_LIMIT)));
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: stderr || error.message });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  },

  start(file, args, options = {}) {
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, detached: OWN_GROUP, stdio: "ignore" });
    const exited = new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("exit", (code) => resolve(code));
    });
    return { pid: child.pid, exited, stop: () => stopGroup(child) };
  },
};
