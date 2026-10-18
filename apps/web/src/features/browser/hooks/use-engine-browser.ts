"use client";

import { useEffect, useState } from "react";
import { browserStreamPath, BrowserStreamEvent, type BrowserTab } from "@telar/engine-client";
import { cockpitPath } from "@/platform/engine/cockpit-path";
import { readEventStream } from "@/platform/engine/event-stream";
import { hostFetcher } from "@/platform/engine/host-client";

export type EngineBrowser = { frame: { src: string; width: number; height: number } | null; tabs: BrowserTab[]; error: string | null };

const RETRY_MAX_MS = 15_000;

async function refusal(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof message === "string" ? message : `The engine answered ${response.status}.`;
}

/** The engine's own browser for a session: its latest frame and tabs. A refusal is final; a dropped connection is retried. */
export function useEngineBrowser(hostId: string, sessionId: string): EngineBrowser {
  const [view, setView] = useState<EngineBrowser>({ frame: null, tabs: [], error: null });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let delay = 1_000;
      while (!signal.aborted) {
        try {
          const response = await hostFetcher(hostId)(cockpitPath(browserStreamPath(sessionId)), { signal, headers: { accept: "text/event-stream" } });
          if (response.status >= 400 && response.status < 500) {
            const error = await refusal(response);
            if (!signal.aborted) setView((current) => ({ ...current, error }));
            return;
          }
          if (!response.ok || !response.body) throw new Error(`browser stream ${response.status}`);
          delay = 1_000;
          setView((current) => ({ ...current, error: null }));
          await readEventStream(response.body, signal, (data) => {
            const parsed = BrowserStreamEvent.safeParse(data);
            if (!parsed.success) return;
            const event = parsed.data;
            if (event.type === "tabs") setView((current) => ({ ...current, tabs: event.tabs }));
            else setView((current) => ({ ...current, frame: { src: `data:image/jpeg;base64,${event.data}`, width: event.width, height: event.height } }));
          });
        } catch {
          if (signal.aborted) return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
        delay = Math.min(delay * 2, RETRY_MAX_MS);
      }
    })();
    return () => controller.abort();
  }, [hostId, sessionId]);
  return view;
}
