"use client";

import { useEffect } from "react";
import type { QuickComposerBridge } from "./front-context";

const EDITOR = '[data-surface="quick"] [data-slot="composer-editor"]';

export function useWindowMode(bridge: QuickComposerBridge | undefined, expanded: boolean, opened: number) {
  useEffect(() => {
    bridge?.mode(expanded ? "expanded" : "compact");
  }, [bridge, expanded, opened]);
  useEffect(
    () =>
      bridge?.onMoved((how) => {
        if (how?.ifIdle && document.activeElement && document.activeElement !== document.body) return;
        document.querySelector<HTMLElement>(EDITOR)?.focus();
      }),
    [bridge],
  );
}
