import fs from "node:fs";
import { z } from "zod";
import { DataScienceConfig, DataScienceMachineSettings } from "@telar/engine-client";
import type { PluginSession } from "../sdk";
import { resolvePythonPath } from "./python-env";

/** Both fields are chosen in the plugin's own settings view, so no generated row draws them. */
export const DataScienceSettings = z.object({
  python: DataScienceConfig.shape.python.meta({ widget: "view" }),
  stack: DataScienceConfig.shape.stack.meta({ widget: "view" }),
});
export type DataScienceSettings = z.infer<typeof DataScienceSettings>;

/** Settings that no longer parse read as none, so the plugin's switch survives a bad value. */
export function projectSettings(raw: Record<string, unknown>): DataScienceSettings {
  const parsed = DataScienceSettings.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export function machineDefaults(raw: Record<string, unknown>): DataScienceMachineSettings {
  const parsed = DataScienceMachineSettings.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * The interpreter a session runs on: the project's own (a relative path resolves against the session's tree,
 * never the project root's), else the Mac's absolute default.
 */
export function resolveInterpreter(session: Pick<PluginSession, "cwd" | "settings" | "machine">): { pythonPath: string } | { refusal: string } {
  const chosen = projectSettings(session.settings).python?.path ?? machineDefaults(session.machine).python;
  if (!chosen) {
    return { refusal: "data science has no Python interpreter: choose one in the project's settings, or set a default Python for this computer under Settings → Plugins" };
  }
  const pythonPath = resolvePythonPath(session.cwd, chosen);
  if (!fs.existsSync(pythonPath)) return { refusal: `data science's Python interpreter is not on disk: ${pythonPath}` };
  return { pythonPath };
}
