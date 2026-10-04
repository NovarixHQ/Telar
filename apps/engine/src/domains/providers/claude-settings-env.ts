import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Without setting sources Claude skips the settings `env` (a gateway login); a session lets it win, so it goes last.
export function withClaudeSettingsEnv(env: Record<string, string | undefined>): Record<string, string> {
  const resolved = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return { ...resolved, ...settingsEnv(resolved["CLAUDE_CONFIG_DIR"] || path.join(os.homedir(), ".claude")) };
}

function settingsEnv(dir: string): Record<string, string> {
  let settings: unknown;
  try {
    settings = (JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")) as { env?: unknown } | null)?.env;
  } catch {
    return {};
  }
  if (typeof settings !== "object" || settings === null) return {};
  return Object.fromEntries(Object.entries(settings).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
