"use client";

import { useEffect } from "react";
import { desktopBrowserBridge } from "@/features/browser/desktop-browser-bridge";
import { syncPageTabs, type NativePages } from "@/features/panel";
import type { useCockpitPanel } from "./use-cockpit-panel";

/** In the desktop app, one panel tab per page of the session's native browser, kept in step with it. */
export function useBrowserPageTabs(sessionId: string | undefined, { updatePanel }: Pick<ReturnType<typeof useCockpitPanel>, "updatePanel">) {
  useEffect(() => {
    const bridge = desktopBrowserBridge();
    if (!bridge || !sessionId) return;
    let cancelled = false;
    let lastActive: string | undefined;
    let read = false;
    const take = (native: NativePages) => {
      if (cancelled) return;
      const active = native.tabs.find((page) => page.active)?.id;
      // The first read sets the baseline: a restored panel keeps the page it was on.
      const since = read ? lastActive : active;
      read = true;
      lastActive = active;
      updatePanel((current) => syncPageTabs(current, native, since));
    };
    // A timer, queued after the panel's own restore, so the first read lands on the restored strip.
    const first = window.setTimeout(() => void bridge.getState(sessionId).then(take, () => undefined), 0);
    const unsubscribe = bridge.onState((state) => {
      if (state.scopeKey === sessionId) take(state);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      unsubscribe();
    };
  }, [sessionId, updatePanel]);
}
