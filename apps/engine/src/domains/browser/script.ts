import { createRequire } from "node:module";
import path from "node:path";

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

export const scriptArgv = (script: string, args: readonly string[]): string[] =>
  inSingleExecutable() ? ["env", `${RUN_SCRIPT_ENV}=${script}`, process.execPath, ...args] : [nodeBinary(), script, ...args];

const forkedShippedModule = (argv: string[]): string | undefined => {
  const [executable, , module] = argv;
  const shipped = `${path.join(path.dirname(executable ?? ""), "node_modules")}${path.sep}`;
  return module?.startsWith(shipped) && /\.[cm]?js$/.test(module) ? module : undefined;
};

export function runShippedScript(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv, sea = inSingleExecutable()): boolean {
  const named = env[RUN_SCRIPT_ENV];
  const forked = !named && sea ? forkedShippedModule(argv) : undefined;
  const script = named ?? forked;
  if (!script) return false;
  delete env[RUN_SCRIPT_ENV];
  argv.splice(1, forked ? 2 : 1, script);
  createRequire(script)(script);
  return true;
}
