"use client";

import { useEffect } from "react";
import { createEngineApi } from "@/platform/engine";
import { usePoll } from "@/ui/hooks/use-poll";
import { useAppearance } from "../appearance";
import { currentShared, fingerprint, markShared, pickShared, readAppliedStamp, shareState, writeAppliedStamp } from "../shared-appearance";
import { readTheme, useTheme } from "./theme-provider";

const api = createEngineApi();

const POLL_MS = 10_000;

const RETIRED_KEYS = [
  "telar-looks",
  "telar-follow-host",
  "telar-host-look-applied",
  "telar-host-look-notice",
  "telar-composition",
  "telar-composition-images",
  "telar-theme-css",
  "telar-backdrop-compiled",
];

/** Keeps this window wearing the host's appearance, whichever window last changed it. */
export function HostLookFollower(): null {
  const { setAppearance } = useAppearance();
  const { setTheme } = useTheme();

  useEffect(() => {
    try {
      for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
    } catch {}
  }, []);

  usePoll(
    async (signal) => {
      const answer = await api.appearance().catch(() => undefined);
      if (!answer || signal.aborted) return false;
      const { appearance, updatedAt } = answer;
      if (appearance === null || updatedAt === null || updatedAt === readAppliedStamp()) {
        if (!shareState().synced) markShared(fingerprint(currentShared(), readTheme()));
        return false;
      }
      setAppearance(pickShared(appearance));
      setTheme(appearance.scheme);
      writeAppliedStamp(updatedAt);
      markShared(fingerprint(currentShared(), appearance.scheme));
      return true;
    },
    POLL_MS,
    { backoff: true },
  );

  return null;
}
