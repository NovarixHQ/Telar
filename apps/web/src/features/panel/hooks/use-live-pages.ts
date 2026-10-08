import { useEffect, useState } from "react";
import { desktopBrowserBridge } from "@/features/browser";
import type { LivePage } from "../model";

/** The shell's live page list for this session's browser, or nothing outside the shell. Stamped with the scope so a session switch drops stale pages. */
export function useLivePages(scopeKey: string | undefined): readonly LivePage[] | undefined {
  const bridge = desktopBrowserBridge();
  const [result, setResult] = useState<{ scopeKey: string; pages: readonly LivePage[] }>();
  useEffect(() => {
    if (!bridge || !scopeKey) return;
    let cancelled = false;
    const take = (state: { scopeKey: string; tabs: LivePage[] }) => {
      if (!cancelled && state.scopeKey === scopeKey) setResult({ scopeKey, pages: state.tabs });
    };
    const first = window.setTimeout(() => void bridge.getState(scopeKey).then(take, () => undefined), 0);
    const unsubscribe = bridge.onState(take);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      unsubscribe();
    };
  }, [bridge, scopeKey]);
  return bridge && result && result.scopeKey === scopeKey ? result.pages : undefined;
}
