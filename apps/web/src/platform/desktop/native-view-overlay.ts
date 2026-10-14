"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { trackOverlayElement, useOverlayLayer } from "./overlay-layer";

type OverlayListener = (hidden: boolean) => void;
/** What an overlay draws. While it is empty the overlay is taken to cover everything. */
export type OverlayElements = Set<Element>;

const claims = new Set<{ elements: OverlayElements }>();
const listeners = new Set<OverlayListener>();

function publish(): void {
  const hidden = claims.size > 0;
  for (const listener of listeners) listener(hidden);
}

export function onNativeViewOverlay(listener: OverlayListener): () => void {
  listeners.add(listener);
  listener(claims.size > 0);
  return () => {
    listeners.delete(listener);
  };
}

export function claimNativeView(elements: OverlayElements = new Set()): () => void {
  const claim = { elements };
  claims.add(claim);
  publish();
  return () => {
    if (!claims.delete(claim)) return;
    publish();
  };
}

export function useNativeViewOverlay(open: boolean, elements?: OverlayElements): void {
  useEffect(() => (open ? claimNativeView(elements) : undefined), [open, elements]);
}

export function useOverlayElements(): OverlayElements {
  return useState<OverlayElements>(() => new Set())[0];
}

const OverlayElementsContext = createContext<OverlayElements | null>(null);
export const NativeViewOverlayElements = OverlayElementsContext.Provider;

export function useOverlayElementRef(elements: OverlayElements | null) {
  const [ref] = useState(() => (element: Element | null) => {
    if (!element || !elements) return;
    elements.add(element);
    return () => void elements.delete(element);
  });
  return ref;
}

export function useOverlayPositioner() {
  const elements = use(OverlayElementsContext);
  const layer = useOverlayLayer();
  const ref = useCallback((element: Element | null) => {
    if (!element) return;
    if (layer) return trackOverlayElement(element);
    elements?.add(element);
    return () => void elements?.delete(element);
  }, [elements, layer]);
  return { ref, container: layer ?? undefined };
}

type OverlayRoot<Details> = {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean, details: Details) => void) | undefined;
};

/** For an overlay's root, controlled or not: pass `onOpenChange` to it and `elements` to a `NativeViewOverlayElements` around it. */
export function useOverlayRootClaim<Details>({ open, defaultOpen, onOpenChange }: OverlayRoot<Details>, popup = false) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen ?? false);
  const elements = useOverlayElements();
  const layer = useOverlayLayer();
  useNativeViewOverlay(!(popup && layer) && (open ?? ownOpen), elements);
  const change = (next: boolean, details: Details) => {
    setOwnOpen(next);
    onOpenChange?.(next, details);
  };
  return { onOpenChange: change, elements };
}

export function nativeViewOverlayHidden(): boolean {
  return claims.size > 0;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function nativeViewCovered(view: DOMRect): boolean {
  if (view.width === 0 || view.height === 0) return false;
  for (const { elements } of claims) {
    if (elements.size === 0) return true;
    for (const element of elements) if (overlaps(element.getBoundingClientRect(), view)) return true;
  }
  return false;
}

export type FrozenFrame = {
  data: string;
  mimeType: string;
  rect: { x: number; y: number; width: number; height: number };
};

/** `paint` resolves once the frame is on screen, so the view only goes down over it. */
export type OverlayShell = {
  capture: () => Promise<FrozenFrame | null>;
  paint: (frame: FrozenFrame | null) => Promise<void>;
  hide: () => Promise<void>;
  show: () => Promise<void>;
};

export function createOverlayFreezer(shell: OverlayShell): (covered: boolean) => Promise<void> {
  let generation = 0;
  let down = false;
  let painted = false;
  let queue: Promise<void> = Promise.resolve();
  const swap = async (covered: boolean, mine: number) => {
    if (generation !== mine) return;
    if (!covered) {
      if (down) await shell.show();
      down = false;
      if (painted) await shell.paint(null);
      painted = false;
      return;
    }
    if (down) return;
    const frame = await shell.capture().catch(() => null);
    if (generation !== mine) return;
    if (frame) {
      painted = true;
      await shell.paint(frame);
      if (generation !== mine) return;
    }
    down = true;
    await shell.hide();
  };
  return (covered: boolean) => {
    const mine = (generation += 1);
    queue = queue.then(() => swap(covered, mine)).catch(() => undefined);
    return queue;
  };
}
