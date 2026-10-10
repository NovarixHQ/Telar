"use client";

import { useEffect, useState, type RefObject } from "react";
import { createOverlayFreezer, nativeViewCovered, onNativeViewOverlay, type FrozenFrame } from "@/platform/desktop/native-view-overlay";

type OverlayBridge = {
  setVisible(scopeKey: string, visible: boolean): Promise<void>;
  captureView?(scopeKey: string): Promise<FrozenFrame | null>;
};

type FrozenOverlayFrame = { src: string; left: number; top: number; width: number; height: number };

async function decoded(src: string): Promise<void> {
  const image = new Image();
  image.src = src;
  await image.decode().catch(() => undefined);
}

const afterPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => setTimeout(resolve, 0)));

function hiddenBySuspense(host: HTMLElement | null): boolean {
  for (let node = host; node; node = node.parentElement) if (node.style.display === "none") return true;
  return false;
}

export function useFrozenOverlay(bridge: OverlayBridge, scopeKey: string, hostRef: RefObject<HTMLElement | null>, overlayRef: RefObject<boolean>) {
  const [frozenFrame, setFrozenFrame] = useState<FrozenOverlayFrame>();
  useEffect(() => {
    let mounted = true;
    let measure = 0;
    const swap = createOverlayFreezer({
      capture: async () => (bridge.captureView ? bridge.captureView(scopeKey) : null),
      hide: () => bridge.setVisible(scopeKey, false),
      show: async () => {
        if (mounted && !hiddenBySuspense(hostRef.current)) await bridge.setVisible(scopeKey, true);
      },
      paint: async (frame) => {
        const host = hostRef.current;
        if (!mounted || !frame || !host) {
          if (mounted) setFrozenFrame(undefined);
          return;
        }
        const src = `data:${frame.mimeType};base64,${frame.data}`;
        await decoded(src);
        const rect = host.getBoundingClientRect();
        setFrozenFrame({ src, left: frame.rect.x - rect.left, top: frame.rect.y - rect.top, width: frame.rect.width, height: frame.rect.height });
        await afterPaint();
      },
    });
    const unsubscribe = onNativeViewOverlay(() => {
      window.cancelAnimationFrame(measure);
      // Measured a frame later: a popup is positioned only after it mounts.
      measure = window.requestAnimationFrame(() => {
        const host = hostRef.current;
        const covered = host ? nativeViewCovered(host.getBoundingClientRect()) : false;
        if (overlayRef.current === covered) return;
        overlayRef.current = covered;
        void swap(covered);
      });
    });
    return () => {
      mounted = false;
      window.cancelAnimationFrame(measure);
      unsubscribe();
    };
  }, [bridge, scopeKey, hostRef, overlayRef]);
  return frozenFrame;
}
