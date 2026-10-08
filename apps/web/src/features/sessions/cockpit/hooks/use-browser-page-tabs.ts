"use client";

import { useEffect } from "react";
import { desktopBrowserBridge } from "@/features/browser/desktop-browser-bridge";
import { syncPageTabs, type NativePages, type PanelTab, type PanelTabState } from "@/features/panel";

/** In the desktop app, one panel tab per page of the session's native browser, kept in step with it. */
export function useBrowserPageTabs(
  sessionId: string | undefined,
  updatePanel: (next: (current: PanelTabState<PanelTab>) => PanelTabState<PanelTab>) => void,
  mayReveal: () => boolean,
) {
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
      const show = read && mayReveal();
      read = true;
      lastActive = active;
      updatePanel((current) => syncPageTabs(current, native, since, show));
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
  }, [sessionId, updatePanel, mayReveal]);
}
