import { EngineStateError } from "../../platform/kernel";
import type { PluginHost } from "./host";

/** The store's reach into the plugin host, which the daemon builds after the store; a store without one has no plugins. */
export class PluginDoors {
  private host?: Pick<PluginHost, "ready" | "releaseSession">;

  attach(host: Pick<PluginHost, "ready" | "releaseSession">): void {
    this.host = host;
  }

  release(sessionId: string, reason: string): void {
    void this.host?.releaseSession(sessionId, reason);
  }

  available(pluginId: string, sessionId: string): boolean {
    return this.host?.ready(pluginId)?.available?.(sessionId) ?? true;
  }

  async call(pluginId: string, verb: string, sessionId: string, input: Record<string, unknown>): Promise<unknown> {
    const module = this.host?.ready(pluginId);
    const route = module?.routes?.[verb];
    if (!route) throw new EngineStateError("invalid_request", `${pluginId} is unavailable`);
    return route(input, module.resolve?.(sessionId));
  }
}
