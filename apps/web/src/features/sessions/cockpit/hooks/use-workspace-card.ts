"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { SessionDiff } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { usePoll } from "@/ui/hooks/use-poll";

const OPEN_KEY = "telar:workspace-card";
const REFRESH_MS = 15_000;
const listeners = new Set<() => void>();

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One choice for every conversation: the card stays where the person left it. */
export function useWorkspaceCardOpen(): { open: boolean; toggle: () => void } {
  const open = useSyncExternalStore(subscribe, readOpen, () => false);
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(OPEN_KEY, readOpen() ? "closed" : "open");
    } catch {
      return;
    }
    for (const listener of listeners) listener();
  }, []);
  return { open, toggle };
}

/** A shared checkout reads against `HEAD`, as the Diff surface does: the HEAD recorded at session start goes stale once the branch moves. */
export function useWorkspaceCardData(hostId: string, sessionId: string, open: boolean, shared: boolean) {
  const [diff, setDiff] = useState<SessionDiff>();
  const load = useCallback(async () => {
    const read = await createEngineApi(hostFetcher(hostId)).sessionDiff(sessionId, shared ? { base: null } : {}).catch(() => undefined);
    if (read?.diff) setDiff(read.diff);
  }, [hostId, sessionId, shared]);
  usePoll(load, open ? REFRESH_MS : null, { key: load });
  return { diff, reload: load };
}
