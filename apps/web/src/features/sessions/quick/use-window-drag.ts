"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { QuickComposerBridge } from "./front-context";

const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="option"], [contenteditable="true"], [data-slot="composer-editor"]';
const TEXT = '[data-slot="quick-reply"], p';
const HOLD_MS = 150;
const SLOP = 4;

export function useWindowDrag(bridge: QuickComposerBridge | undefined) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (!bridge || event.button !== 0 || target.closest(CONTROL)) return;
    const onText = Boolean(target.closest(TEXT));
    if (!onText) event.preventDefault();
    const surface = event.currentTarget;
    const from = { x: event.screenX, y: event.screenY, at: event.timeStamp };
    let dragging = false;
    const start = () => {
      dragging = true;
      surface.setPointerCapture?.(event.pointerId);
      bridge.drag({ phase: "start" });
    };
    if (!onText) start();
    const move = (next: PointerEvent) => {
      const dx = next.screenX - from.x;
      const dy = next.screenY - from.y;
      if (!dragging) {
        if (next.timeStamp - from.at < HOLD_MS) {
          if (Math.hypot(dx, dy) > SLOP) stop();
          return;
        }
        window.getSelection()?.removeAllRanges();
        start();
      }
      bridge.drag({ phase: "move", dx, dy });
    };
    const stop = () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", stop);
      surface.removeEventListener("pointercancel", stop);
      if (dragging) bridge.drag({ phase: "end" });
      dragging = false;
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);
  };
}
