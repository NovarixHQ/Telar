"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { QuickComposerBridge } from "./front-context";

const GRIP = '[data-slot="input-group-addon"][data-align="block-end"], [data-slot="quick-hint"]';
const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [contenteditable="true"]';

export function useWindowDrag(bridge: QuickComposerBridge | undefined) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (!bridge || event.button !== 0 || !target.closest(GRIP) || target.closest(CONTROL)) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const from = { x: event.screenX, y: event.screenY };
    grip.setPointerCapture?.(event.pointerId);
    bridge.drag({ phase: "start" });
    const move = (next: PointerEvent) => bridge.drag({ phase: "move", dx: next.screenX - from.x, dy: next.screenY - from.y });
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      bridge.drag({ phase: "end" });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  };
}
