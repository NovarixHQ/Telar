"use client";

import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { QuickComposerBridge, Room } from "./front-context";

const FIELD = '[data-slot="composer-editor"]';
const SLOP = 3;
const FIRST_ROOM: Room = { above: 400 };

export function useWindowLayout(bridge: QuickComposerBridge | undefined, root: RefObject<HTMLElement | null>, composer: RefObject<HTMLElement | null>, structure: string) {
  const [room, setRoom] = useState<Room>(FIRST_ROOM);
  useEffect(() => bridge?.onRoom(setRoom), [bridge]);
  useEffect(() => {
    const node = root.current;
    if (!bridge || !node) return;
    const frame = requestAnimationFrame(() => bridge.layout({ height: node.scrollHeight, composerTop: composer.current?.offsetTop ?? 0 }));
    return () => cancelAnimationFrame(frame);
  }, [bridge, root, composer, structure]);
  return room;
}

export function useFieldDrag(bridge: QuickComposerBridge | undefined, fieldEmpty: boolean) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (!bridge || !fieldEmpty || event.button !== 0 || !(event.target as Element).closest(FIELD)) return;
    const surface = event.currentTarget;
    const from = { x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY };
    let dragging = false;
    const move = (next: PointerEvent) => {
      if (dragging || Math.hypot(next.screenX - from.screenX, next.screenY - from.screenY) <= SLOP) return;
      dragging = true;
      window.getSelection()?.removeAllRanges();
      surface.setPointerCapture?.(event.pointerId);
      bridge.drag({ phase: "start", offsetX: from.x, offsetY: from.y });
    };
    const stop = () => {
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", stop);
      surface.removeEventListener("pointercancel", stop);
      if (dragging) bridge.drag({ phase: "end" });
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);
  };
}
