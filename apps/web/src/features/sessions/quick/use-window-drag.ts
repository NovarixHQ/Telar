"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { QuickComposerBridge } from "./front-context";

const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="option"], [contenteditable="true"]';
const FIELD = '[data-slot="composer-editor"]';
const TEXT = '[data-slot="quick-reply"], p';
const HOLD_MS = 150;
const SLOP = 3;

type Grab = "now" | "on-move" | "on-hold";

function grabOf(target: Element, fieldEmpty: boolean): Grab | null {
  if (target.closest(FIELD)) return fieldEmpty ? "on-move" : null;
  if (target.closest(CONTROL)) return null;
  return target.closest(TEXT) ? "on-hold" : "now";
}

export function useWindowDrag(bridge: QuickComposerBridge | undefined, fieldEmpty: boolean) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    const grab = event.button === 0 && bridge ? grabOf(event.target as Element, fieldEmpty) : null;
    if (!bridge || !grab) return;
    if (grab === "now") event.preventDefault();
    const surface = event.currentTarget;
    const from = { x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY, at: event.timeStamp };
    let dragging = false;
    const start = () => {
      dragging = true;
      window.getSelection()?.removeAllRanges();
      surface.setPointerCapture?.(event.pointerId);
      bridge.drag({ phase: "start", offsetX: from.x, offsetY: from.y });
    };
    const move = (next: PointerEvent) => {
      if (dragging) return;
      const moved = Math.hypot(next.screenX - from.screenX, next.screenY - from.screenY) > SLOP;
      if (grab === "on-hold" && next.timeStamp - from.at < HOLD_MS) {
        if (moved) stop();
      } else if (moved || grab === "on-hold") {
        start();
      }
    };
    const stop = () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", stop);
      surface.removeEventListener("pointercancel", stop);
      if (dragging) bridge.drag({ phase: "end" });
      dragging = false;
    };
    if (grab === "now") start();
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);
  };
}
