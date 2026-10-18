import os from "node:os";
import path from "node:path";

/** The CLI's own default: never the desktop app's data directory. */
function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  return path.join(base, "telar");
}

export function resolveHome(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(flag ?? env.TELAR_HOME?.trim() ?? defaultHome(env));
}
