"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_BACKGROUND, type Background, type SharedAppearance } from "@telar/engine-client";
import { parseAppearance } from "./appearance";

const APPEARANCE_KEY = "telar-appearance";
const APPLIED_KEY = "telar-host-appearance-applied";

export function currentShared(): SharedAppearance {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(APPEARANCE_KEY);
  } catch {}
  return pickShared(parseAppearance(raw));
}

export function pickShared(appearance: SharedAppearance): SharedAppearance & { background: Background } {
  return {
    background: appearance.background ?? DEFAULT_BACKGROUND,
    accent: appearance.accent,
    fontSans: appearance.fontSans,
    fontMono: appearance.fontMono,
    fontSansCustom: appearance.fontSansCustom,
    fontMonoCustom: appearance.fontMonoCustom,
    fontSize: appearance.fontSize,
    fontMonoSize: appearance.fontMonoSize,
    translucencyLevel: appearance.translucencyLevel,
    depth: appearance.depth,
  };
}

export function fingerprint(shared: SharedAppearance, scheme: string): string {
  return JSON.stringify([shared, scheme]);
}

const listeners = new Set<() => void>();
let state: { synced: boolean; shared?: string } = { synced: false };

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** A window publishes only once it has caught up with the host, so a fresh browser never overwrites it with defaults. */
export function shareState(): Readonly<typeof state> {
  return state;
}

export function markShared(shared: string): void {
  state = { synced: true, shared };
  for (const listener of listeners) listener();
}

const UNSYNCED = { synced: false } as const;

export function useShareState(): Readonly<typeof state> {
  return useSyncExternalStore(subscribe, () => state, () => UNSYNCED);
}

export function readAppliedStamp(): number | null {
  try {
    const stamp = Number(window.localStorage.getItem(APPLIED_KEY) ?? Number.NaN);
    return Number.isFinite(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

export function writeAppliedStamp(stamp: number): void {
  try {
    window.localStorage.setItem(APPLIED_KEY, String(stamp));
  } catch {}
}
