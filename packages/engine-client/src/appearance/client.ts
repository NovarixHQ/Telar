import type { EngineTransport } from "../platform/transport";
import { parsePublishedAppearance, type PublishedAppearance } from "./schema";

export const appearanceClient = {
  async appearance(this: EngineTransport): Promise<{ appearance: PublishedAppearance | null; updatedAt: number | null }> {
    const raw = await this.request<{ appearance?: unknown; updatedAt?: unknown }>("GET", "/v2/appearance");
    return {
      appearance: parsePublishedAppearance(raw.appearance) ?? null,
      updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    };
  },

  setAppearance(this: EngineTransport, blob: PublishedAppearance): Promise<{ ok: boolean; updatedAt: number; etag: string }> {
    return this.request("PUT", "/v2/appearance", blob);
  },

  /** Idempotent: clearing when nothing is published is still a 200. */
  clearAppearance(this: EngineTransport): Promise<{ ok: boolean }> {
    return this.request("DELETE", "/v2/appearance");
  },
};
