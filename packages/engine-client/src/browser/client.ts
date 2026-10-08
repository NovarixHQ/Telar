import type { BrowserSnapshot } from "../protocol/common";
import type { EngineTransport } from "../platform/transport";

const browserPath = (sessionId: string) => `/v2/sessions/${encodeURIComponent(sessionId)}/browser`;

export const browserClient = {
  browserState(this: EngineTransport, sessionId: string, options: { screenshot?: boolean; start?: boolean } = {}): Promise<{ browser: BrowserSnapshot }> {
    const query = new URLSearchParams();
    if (options.screenshot) query.set("screenshot", "1");
    if (options.start) query.set("start", "1");
    return this.request("GET", `${browserPath(sessionId)}${query.size > 0 ? `?${query.toString()}` : ""}`);
  },

  /** Opens an http(s) page as a new tab, as the person would, for clients without a desktop shell. */
  browserOpen(this: EngineTransport, sessionId: string, url: string): Promise<{ browser: BrowserSnapshot }> {
    return this.request("POST", `${browserPath(sessionId)}/open`, { url });
  },
};
