"use client";

import { useEffect, useState } from "react";
import type { QuickComposerBridge } from "./front-context";

const EDITOR = '[data-surface="quick"] [data-slot="composer-editor"]';

export function useWindowMode(bridge: QuickComposerBridge | undefined, expanded: boolean, opened: number) {
  const wanted = expanded ? "expanded" : "compact";
  const [size, setSize] = useState<"compact" | "expanded" | undefined>(undefined);
  useEffect(() => bridge?.onResized(setSize), [bridge]);
  useEffect(() => {
    bridge?.mode(wanted);
  }, [bridge, wanted, opened]);
  useEffect(
    () =>
      bridge?.onMoved((how) => {
        if (how?.ifIdle && document.activeElement && document.activeElement !== document.body) return;
        document.querySelector<HTMLElement>(EDITOR)?.focus();
      }),
    [bridge],
  );
  return !bridge || size === wanted;
}
