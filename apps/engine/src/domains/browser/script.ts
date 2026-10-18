import { createRequire } from "node:module";

const RUN_SCRIPT_ENV = "TELAR_RUN_SCRIPT";

const require = createRequire(import.meta.url);

const inSingleExecutable = (): boolean => {
  try {
    return require("node:sea").isSea() === true;
  } catch {
    return false;
  }
};

const nodeBinary = (): string => (process.versions.bun ? (Bun.which("node") ?? process.execPath) : process.execPath);

/** The command that runs a Node script. A single executable has no `node` beside it, so it runs the script itself. */
export const scriptArgv = (script: string, args: readonly string[]): string[] =>
  inSingleExecutable() ? ["env", `${RUN_SCRIPT_ENV}=${script}`, process.execPath, ...args] : [nodeBinary(), script, ...args];

/** Entry point of a single executable started to run a script instead of the CLI. */
export function runScriptFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const script = env[RUN_SCRIPT_ENV];
  if (!script) return false;
  delete env[RUN_SCRIPT_ENV];
  process.argv.splice(1, 1, script);
  createRequire(script)(script);
  return true;
}
