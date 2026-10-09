"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CardSpot, FrontContext, QuickComposerBridge } from "./front-context";

const CONTROL = 'button, a, input, select, textarea, [role="button"], [role="combobox"], [role="option"], [contenteditable="true"]';
const FIELD = '[data-slot="composer-editor"]';
const TEXT = '[data-slot="quick-transcript"], p';
const HOLD_MS = 150;
const SLOP = 3;
export const CARD_WIDTH = 680;

type Grab = "now" | "on-move" | "on-hold";

function grabOf(target: Element, fieldEmpty: boolean): Grab | null {
  if (target.closest(FIELD)) return fieldEmpty ? "on-move" : null;
  if (target.closest(CONTROL)) return null;
  return target.closest(TEXT) ? "on-hold" : "now";
}

type Area = { width: number; height: number };

function clamp(spot: CardSpot, area: Area): CardSpot {
  const x = Math.min(Math.max(0, spot.x), Math.max(0, area.width - CARD_WIDTH));
  const y = Math.min(Math.max(0, spot.y), Math.max(0, area.height - 120));
  return { x, y };
}

const centred = (area: Area): CardSpot => ({ x: Math.round((area.width - CARD_WIDTH) / 2), y: Math.round(area.height * 0.4) });
const outside = (event: { clientX: number; clientY: number }, area: Area) => event.clientX < 0 || event.clientY < 0 || event.clientX >= area.width || event.clientY >= area.height;

type Placed = { spot: CardSpot; area: Area };

export function useCardDrag(bridge: QuickComposerBridge | undefined, opened: FrontContext | null, fieldEmpty: boolean) {
  const [dragged, setDragged] = useState<{ from: FrontContext | null; spot: CardSpot; area?: Area }>();
  const rebase = useRef<((placed: Placed) => void) | null>(null);
  const own = dragged && dragged.from === opened ? dragged : undefined;
  const area = own?.area ?? opened?.area ?? { width: window.innerWidth, height: window.innerHeight };
  const spot = clamp(own?.spot ?? opened?.spot ?? centred(area), area);

  useEffect(
    () =>
      bridge?.onPlace((placed) => {
        setDragged({ from: opened, spot: placed.spot, area: placed.area });
        rebase.current?.(placed);
      }),
    [bridge, opened],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const grab = event.button === 0 ? grabOf(event.target as Element, fieldEmpty) : null;
    if (!grab) return;
    if (grab === "now") event.preventDefault();
    const card = event.currentTarget;
    let from = { x: event.clientX, y: event.clientY };
    let origin = spot;
    let bounds = area;
    const at = event.timeStamp;
    const hold = { x: from.x - origin.x, y: from.y - origin.y };
    let dragging = grab === "now";
    let crossing = false;
    let last = spot;
    if (dragging) card.setPointerCapture?.(event.pointerId);
    rebase.current = (placed) => {
      origin = clamp(placed.spot, placed.area);
      bounds = placed.area;
      from = { x: origin.x + hold.x, y: origin.y + hold.y };
      last = origin;
      crossing = false;
    };
    const move = (next: PointerEvent) => {
      const dx = next.clientX - from.x;
      const dy = next.clientY - from.y;
      if (!dragging) {
        const moved = Math.hypot(dx, dy) > SLOP;
        if (grab === "on-hold" && next.timeStamp - at < HOLD_MS) return moved ? stop() : undefined;
        if (!moved && grab === "on-move") return;
        dragging = true;
        window.getSelection()?.removeAllRanges();
        card.setPointerCapture?.(event.pointerId);
      }
      if (outside(next, bounds) && !crossing) {
        crossing = true;
        bridge?.cross({ grabX: hold.x, grabY: hold.y });
      }
      last = clamp({ x: origin.x + dx, y: origin.y + dy }, bounds);
      setDragged({ from: opened, spot: last, area: bounds });
    };
    const stop = () => {
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", stop);
      card.removeEventListener("pointercancel", stop);
      rebase.current = null;
      if (dragging && last !== spot) bridge?.moved(last);
      dragging = false;
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", stop);
    card.addEventListener("pointercancel", stop);
  };

  return { spot, area, onPointerDown };
}

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
