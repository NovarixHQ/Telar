"use client";

import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { QuickComposerBridge, Room } from "./front-context";

const FIELD = '[data-slot="composer-editor"]';
const SLOP = 3;
const MENU_ROOM_PX = 320;
const OPEN_MENU = "[data-side]";
const FIRST_ROOM: Room = { above: 400, below: 300 };

function useOpenMenu(root: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen([...document.querySelectorAll(OPEN_MENU)].some((node) => !root.current?.contains(node)));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root]);
  return open;
}

export function useWindowLayout(bridge: QuickComposerBridge | undefined, root: RefObject<HTMLElement | null>, composer: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState<Room>(FIRST_ROOM);
  const menuOpen = useOpenMenu(root);
  const reserve = menuOpen ? MENU_ROOM_PX : 0;

  useEffect(() => bridge?.onRoom(setRoom), [bridge]);

  useEffect(() => {
    const node = root.current;
    if (!bridge || !node) return;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => bridge.layout({ height: node.scrollHeight, composerTop: composer.current?.offsetTop ?? 0 }));
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [bridge, root, composer, reserve]);

  return { room, reserve };
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
