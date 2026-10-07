"use client";

import { useState, type ComponentProps } from "react";
import type { SessionChild, SessionChildState } from "@telar/engine-client";
import type { Composer } from "@/features/composer";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { childPending } from "./use-session-children";

/** The composer's builders notice: the batches still out, counted by state, and one press that stops every one still out. */
export function useBuildersBanner(hostId: string, agents: readonly SessionChild[]): ComponentProps<typeof Composer>["builders"] {
  const [stopping, setStopping] = useState(false);
  const out = agents.filter(childPending);
  if (out.length === 0) return undefined;
  const batches = new Set(out.map((child) => child.parentRunId));
  const counts: Partial<Record<SessionChildState, number>> = {};
  for (const child of agents) if (batches.has(child.parentRunId)) counts[child.state] = (counts[child.state] ?? 0) + 1;
  const onStopAll = () => {
    const api = createEngineApi(hostFetcher(hostId));
    setStopping(true);
    void Promise.allSettled(out.map((child) => api.stopSession(child.sessionId))).then(() => setStopping(false));
  };
  return { counts, stopping, onStopAll };
}
