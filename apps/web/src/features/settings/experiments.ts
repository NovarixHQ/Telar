"use client";

import { useCallback, useSyncExternalStore } from "react";

/** A trial changes only how the UI looks or behaves on this device; engine data is the same either way. */
export type Experiment = { id: string; label: string; hint: string; decideBy: string };

export const EXPERIMENTS: readonly Experiment[] = [
  { id: "agent-catalog", label: "Agent catalog", hint: "Install agents from the public catalog as new logins on the Providers page.", decideBy: "2026-11-06" },
];

const KEY = (id: string) => `telar:experiment:${id}`;
const CHANGED = "telar:experiments";

function readExperiment(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY(id)) === "on";
  } catch {
    return false;
  }
}

function setExperiment(id: string, on: boolean): void {
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

export function decideByLabel(decideBy: string): string {
  return new Date(`${decideBy}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
