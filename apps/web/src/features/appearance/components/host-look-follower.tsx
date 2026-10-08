"use client";

import { useEffect } from "react";
import { createEngineApi } from "@/platform/engine";
import { useAppearance } from "../appearance";
import { currentShared, fingerprint, markShared, readAppliedStamp, shareState, wearShared, writeAppliedStamp } from "../shared-appearance";
import { hostVisible, subscribeHostVisibility } from "@/platform/desktop/host-visibility";
import { readTheme, useTheme } from "./theme-provider";

const api = createEngineApi();

const POLL_MS = 10_000;

const RETIRED_KEYS = ["telar-looks", "telar-follow-host", "telar-host-look-applied", "telar-host-look-notice"];

/** Keeps this window wearing the host's appearance, whichever window last changed it. */
export function HostLookFollower(): null {
  const { setAppearance } = useAppearance();
  const { setTheme } = useTheme();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
    } catch {}

    let live = true;
    let inFlight = false;

    const ask = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const answer = await api.appearance();
        if (!live) return;
        const { appearance, updatedAt } = answer;
        if (appearance === null || updatedAt === null || updatedAt === readAppliedStamp()) {
          if (!shareState().synced) markShared({ shared: fingerprint(currentShared(), readTheme()) });
          return;
        }
        const notice = wearShared(appearance, setAppearance);
        setTheme(appearance.scheme);
        writeAppliedStamp(updatedAt);
        markShared({ shared: fingerprint(currentShared(), appearance.scheme), notice });
      } catch {
      } finally {
        inFlight = false;
      }
    };

    void ask();
    const timer = window.setInterval(() => void ask(), POLL_MS);
    const unsubscribe = subscribeHostVisibility(() => {
      if (hostVisible()) void ask();
    });
    return () => {
      live = false;
      window.clearInterval(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
