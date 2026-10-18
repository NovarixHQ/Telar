import os from "node:os";
import path from "node:path";

/** TELAR_HOME if set, else the platform's data directory: Application Support on macOS, XDG data home elsewhere. */
export function telarHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = env.HOME || os.homedir()): string {
  const explicit = env.TELAR_HOME?.trim();
  if (explicit) return explicit;
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Telar");
  return path.join(env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share"), "telar");
}
