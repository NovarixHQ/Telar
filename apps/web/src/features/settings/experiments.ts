"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = (id: string) => `telar:experiment:${id}`;
const CHANGED = "telar:experiments";

function readExperiment(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY(id)) === "on";
  } catch {
    return false;
  }
}

export function setExperiment(id: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(KEY(id), "on");
    else window.localStorage.removeItem(KEY(id));
  } catch {}
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useExperiment(id: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => readExperiment(id), () => false);
  const set = useCallback((next: boolean) => setExperiment(id, next), [id]);
  return [on, set];
}
