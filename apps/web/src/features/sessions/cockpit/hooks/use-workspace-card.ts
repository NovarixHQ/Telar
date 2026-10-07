"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { SessionChild, SessionDiff } from "@telar/engine-client";
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

/** The card's git and builder reads, polled only while it shows. */
export function useWorkspaceCardData(hostId: string, sessionId: string, open: boolean) {
  const [diff, setDiff] = useState<SessionDiff>();
  const [children, setChildren] = useState<SessionChild[]>([]);
  const load = useCallback(async () => {
    const api = createEngineApi(hostFetcher(hostId));
    const [diffRead, childrenRead] = await Promise.allSettled([api.sessionDiff(sessionId), api.children(sessionId)]);
    if (diffRead.status === "fulfilled" && diffRead.value.diff) setDiff(diffRead.value.diff);
    if (childrenRead.status === "fulfilled" && Array.isArray(childrenRead.value.children)) setChildren(childrenRead.value.children);
  }, [hostId, sessionId]);
  usePoll(load, open ? REFRESH_MS : null, { key: load });
  return { diff, children, reload: load };
}
