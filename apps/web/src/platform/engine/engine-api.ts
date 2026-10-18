import { EngineClientError } from "@telar/engine-client";
import { enginePipe, engineRoute } from "@/platform/engine/server";

const OPEN = new Set([
  "about", "agent-catalog", "appearance", "browser-logins", "claude", "cleanup", "computer-use", "data-science", "dictation", "fs", "github",
  "health", "hosts", "inbox", "latex", "mcp-servers", "models", "orientation", "ping", "plugin-assets", "plugins", "projects", "provider-instances",
  "provider-updates", "schedules", "session-defaults", "sessions", "sidebar-layout", "simulator-settings", "simulators", "storage", "terminals", "textgen", "usage",
  "workspace", "worktrees", "worktrees-root",
]);

/** Everything else the engine serves (auth, devices, pairing, push) needs the host's own credentials or a route that adds to the answer. */
function reachable(segments: string[]): boolean {
  const [family, second] = segments;
  if (!family) return false;
  if (family === "push") return second === "webhook";
  if (family === "remote") return segments.length === 3 && second === "devices";
  return OPEN.has(family);
}

export type EngineApiContext = { params: Promise<{ path: string[] }> };

export const engineApi = engineRoute(async (request: Request, context: EngineApiContext) => {
  const [version, ...rest] = (await context.params).path;
  if (version !== "v2" || !reachable(rest)) throw new EngineClientError("not_found", "engine endpoint does not exist");
  return enginePipe(request, `/v2/${rest.map(encodeURIComponent).join("/")}${new URL(request.url).search}`);
});
