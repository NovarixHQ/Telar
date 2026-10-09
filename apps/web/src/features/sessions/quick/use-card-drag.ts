"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CardSpot, QuickComposerBridge } from "./front-context";

const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="option"], [contenteditable="true"]';
const FIELD = '[data-slot="composer-editor"]';
const TEXT = '[data-slot="quick-reply"], p';
const HOLD_MS = 150;
const SLOP = 3;
export const CARD_WIDTH = 680;

type Grab = "now" | "on-move" | "on-hold";

function grabOf(target: Element, fieldEmpty: boolean): Grab | null {
  if (target.closest(FIELD)) return fieldEmpty ? "on-move" : null;
  if (target.closest(CONTROL)) return null;
  return target.closest(TEXT) ? "on-hold" : "now";
}

function clamp(spot: CardSpot): CardSpot {
  const x = Math.min(Math.max(0, spot.x), Math.max(0, window.innerWidth - CARD_WIDTH));
  const y = Math.min(Math.max(0, spot.y), Math.max(0, window.innerHeight - 120));
  return { x, y };
}

const centred = (): CardSpot => ({ x: Math.round((window.innerWidth - CARD_WIDTH) / 2), y: Math.round(window.innerHeight * 0.2) });

export function useCardDrag(bridge: QuickComposerBridge | undefined, saved: CardSpot | null | undefined, fieldEmpty: boolean) {
  const [dragged, setDragged] = useState<{ from: CardSpot | null | undefined; spot: CardSpot }>();
  const spot = clamp(dragged && dragged.from === saved ? dragged.spot : (saved ?? centred()));

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const grab = event.button === 0 ? grabOf(event.target as Element, fieldEmpty) : null;
    if (!grab) return;
    if (grab === "now") event.preventDefault();
    const card = event.currentTarget;
    const from = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    let dragging = grab === "now";
    let last = spot;
    if (dragging) card.setPointerCapture?.(event.pointerId);
    const move = (next: PointerEvent) => {
      const dx = next.clientX - from.x;
      const dy = next.clientY - from.y;
      if (!dragging) {
        const moved = Math.hypot(dx, dy) > SLOP;
        if (grab === "on-hold" && next.timeStamp - from.at < HOLD_MS) return moved ? stop() : undefined;
        if (!moved && grab === "on-move") return;
        dragging = true;
        window.getSelection()?.removeAllRanges();
        card.setPointerCapture?.(event.pointerId);
      }
      last = clamp({ x: spot.x + dx, y: spot.y + dy });
      setDragged({ from: saved, spot: last });
    };
    const stop = () => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", stop);
      card.removeEventListener("pointercancel", stop);
      if (dragging && last !== spot) bridge?.moved(last);
      dragging = false;
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", stop);
    card.addEventListener("pointercancel", stop);
  };

  return { spot, onPointerDown };
}

/** Lets clicks through the transparent overlay, and takes them while the pointer is over anything drawn. */
export function useClickThrough(bridge: QuickComposerBridge | undefined, root: RefObject<HTMLElement | null>, openedWith: unknown) {
  const over = useRef(false);
  useEffect(() => {
    over.current = false;
  }, [openedWith]);
  useEffect(() => {
    if (!bridge) return;
    const onMove = (event: MouseEvent) => {
      const target = event.target;
      const drawn = target instanceof Element && target !== root.current && target !== document.body && target !== document.documentElement;
      if (drawn === over.current) return;
      over.current = drawn;
      bridge.interactive(drawn);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [bridge, root]);
}
