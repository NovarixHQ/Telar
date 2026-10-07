"use client";

import { useEffect, useRef, useState } from "react";
import { SquareArrowOutUpRightIcon } from "lucide-react";
import { Button } from "@/ui/button";
import type { DesktopBrowserBridge } from "../types";

export function usePoppedScope(bridge: DesktopBrowserBridge, scopeKey: string, onEnded?: () => void): boolean {
  const [popped, setPopped] = useState(false);
  const poppedRef = useRef(false);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    endedRef.current = onEnded;
  });
  useEffect(() => {
    let cancelled = false;
    const apply = (next: boolean) => {
      poppedRef.current = next;
      setPopped(next);
    };
    void bridge.getState(scopeKey).then((state) => { if (!cancelled) apply(Boolean(state.popped)); }, () => undefined);
    const unsubscribe = bridge.onState((state) => {
      if (state.scopeKey !== scopeKey) return;
      if (state.ended && poppedRef.current) endedRef.current?.();
      apply(Boolean(state.popped));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, scopeKey]);
  return popped;
}

export function PoppedBrowser({ bridge, scopeKey }: { bridge: DesktopBrowserBridge; scopeKey: string }) {
  const act = (action: string) => void bridge.action(scopeKey, { action }).catch(() => undefined);
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
      </div>
    </div>
  );
}
