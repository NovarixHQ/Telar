"use client";

import { useEffect, useRef, useState } from "react";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "@/ui/button";
import type { DesktopBrowserBridge, DesktopBrowserPanelState } from "../types";

export function usePoppedScope(bridge: DesktopBrowserBridge, scopeKey: string, onEnded?: () => void): { popped: boolean; compact: boolean } {
  const [shown, setShown] = useState({ popped: false, compact: false });
  const poppedRef = useRef(false);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    endedRef.current = onEnded;
  });
  useEffect(() => {
    let cancelled = false;
    const apply = (state: DesktopBrowserPanelState) => {
      poppedRef.current = Boolean(state.popped);
      setShown({ popped: Boolean(state.popped), compact: Boolean(state.compact) });
    };
    void bridge.getState(scopeKey).then((state) => { if (!cancelled) apply(state); }, () => undefined);
    const unsubscribe = bridge.onState((state) => {
      if (state.scopeKey !== scopeKey) return;
      if (state.ended && poppedRef.current) endedRef.current?.();
      apply(state);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, scopeKey]);
  return shown;
}

export function PoppedBrowser({ bridge, scopeKey, compact }: { bridge: DesktopBrowserBridge; scopeKey: string; compact: boolean }) {
  const act = (action: string, extra: Record<string, unknown> = {}) => void bridge.action(scopeKey, { action, ...extra }).catch(() => undefined);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
      <SquareArrowOutUpRightIcon aria-hidden className="size-4" />
      <p>In its own window</p>
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => act("show-window")}>
          Show
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => act("bring-back")}>
          Bring back
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => act("float", { on: !compact })}>
          {compact ? "Turn off on top" : "Float on top"}
        </Button>
      </div>
    </div>
  );
}
