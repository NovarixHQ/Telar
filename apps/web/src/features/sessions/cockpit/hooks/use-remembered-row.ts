"use client";

import { useSyncExternalStore } from "react";
import { rememberedRow } from "../../rail/sidebar-cache";

const unchanging = () => () => {};

export function useRememberedRow(hostId: string, sessionId: string | undefined) {
  return useSyncExternalStore(
    unchanging,
    () => (sessionId ? rememberedRow(hostId, sessionId) : undefined),
    () => undefined,
  );
}
