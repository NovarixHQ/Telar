"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hostFetcher, LOCAL_HOST_ID, rewriteApiPath } from "@/platform/engine/host-client";
import { createRunApi, runPath, type RunApi } from "./api";
import { runStatusSource } from "./status-port";
import type { RunStatusAnswer, RunStatusEvent } from "./types";

/** Folds one frame into a `/run/status` answer: the frame replaces its terminal by id, newest first, like a fresh read. */
export function applyRunStatusEvent(answer: RunStatusAnswer | undefined, event: RunStatusEvent): RunStatusAnswer {
  const base: RunStatusAnswer = answer ?? { terminals: [] };
  const terminals = [event.run, ...(base.terminals ?? []).filter((run) => run.terminalId !== event.run.terminalId)].sort((a, b) => b.startedAt - a.startedAt);
  return { ...(base.sessionWorktreePath ? { sessionWorktreePath: base.sessionWorktreePath } : {}), terminals };
}

export type RunStatusFeed = {
  status: RunStatusAnswer | undefined;
  error: string | undefined;
  /** Re-reads the state after a mutation this screen made; not a poll. */
  refresh: () => void;
};

export function useRunStatusFeed({
  sessionId,
  hostId,
  api: injected,
}: {
  sessionId: string;
  hostId?: string;
  /** Injected by tests and the fixture; production builds a pinned client. */
  api?: RunApi;
}): RunStatusFeed {
  const [status, setStatus] = useState<RunStatusAnswer>();
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState(0);
  // Pinned: session ids are per host and can collide.
  const api = useMemo(() => injected ?? createRunApi(hostFetcher(hostId ?? LOCAL_HOST_ID)), [injected, hostId]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    const readState = () =>
      api.status(sessionId).then(
        (answer) => {
          if (stopped) return;
          setStatus(answer);
          setError(undefined);
        },
        (cause) => !stopped && setError(cause instanceof Error ? cause.message : "The run feed is not answering."),
      );
    void readState();
    let opens = 0;
    const path = rewriteApiPath(runPath(sessionId, "/stream"), hostId ?? LOCAL_HOST_ID);
    const unsubscribe = runStatusSource().subscribe(path, (signal) => {
      if (stopped) return;
      // The feed has no replay: every reconnect after the first re-reads the state.
      if (signal.type === "open") {
        if (opens++ > 0) void readState();
      } else if (signal.type === "error") setError(signal.message);
      else setStatus((current) => applyRunStatusEvent(current, signal.event));
    });
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [api, sessionId, hostId, generation]);

  return { status, error, refresh };
}
