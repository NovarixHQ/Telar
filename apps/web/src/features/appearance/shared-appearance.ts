"use client";

import { useSyncExternalStore } from "react";
import type { SharedAppearance } from "@telar/engine-client";
import { parseAppearance, type Appearance } from "./appearance";
import { currentComposition, strandedTones, writeComposition } from "./composition";

type SharedFields = Omit<SharedAppearance, "composition" | "images">;

const APPEARANCE_KEY = "telar-appearance";
const APPLIED_KEY = "telar-host-appearance-applied";

const QUOTA_MESSAGE = "The host's layer images would not fit in this browser's storage; everything else was applied.";

function tintMessage(tones: readonly string[]): string {
  const named = tones.length === 1 ? tones[0] : `${tones.slice(0, -1).join(", ")} and ${tones[tones.length - 1]}`;
  const one = tones.length === 1;
  return `The card sits too close to the ${named} colour${one ? "" : "s"}, so ${one ? "that tint" : "those tints"} will be hard to read.`;
}

function sharedFields(appearance: Appearance): SharedFields {
  return {
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

export function currentShared(): SharedAppearance {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(APPEARANCE_KEY);
  } catch {}
  return { ...currentComposition(), ...sharedFields(parseAppearance(raw)) };
}

export function fingerprint(shared: SharedAppearance, scheme: string): string {
  return JSON.stringify([shared, scheme]);
}

/** Wears the host's appearance in this window; answers a notice when part of it could not be worn as-is. */
export function wearShared(shared: SharedAppearance, setAppearance: (patch: SharedFields) => void): string | undefined {
  const { composition, images, ...fields } = shared;
  const stored = writeComposition(composition, images);
  setAppearance(fields);
  const notices: string[] = [];
  if (!stored) notices.push(QUOTA_MESSAGE);
  const stranded = strandedTones(composition);
  if (stranded.length > 0) notices.push(tintMessage(stranded));
  return notices.length > 0 ? notices.join(" ") : undefined;
}

const listeners = new Set<() => void>();
let state: { synced: boolean; shared?: string; notice?: string } = { synced: false };

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** A window publishes only once it has caught up with the host, so a fresh browser never overwrites it with defaults. */
export function shareState(): Readonly<typeof state> {
  return state;
}

export function markShared(next: { shared: string; notice?: string }): void {
  state = { synced: true, ...next };
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
