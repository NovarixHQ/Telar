"use client";

import { useEffect, useSyncExternalStore } from "react";

let filling = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePanelFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => filling, () => false);
}

export function usePublishPanelFullscreen(fullscreen: boolean): void {
  useEffect(() => {
    if (!fullscreen) return;
    filling = true;
    for (const listener of listeners) listener();
    return () => {
      filling = false;
      for (const listener of listeners) listener();
    };
  }, [fullscreen]);
}
