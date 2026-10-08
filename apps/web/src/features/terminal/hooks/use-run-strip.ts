"use client";

import { useEffect, useMemo, useState } from "react";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { createRunApi } from "../run/api";
import { useRunStatusFeed } from "../run/status-stream";
import type { RunConfigurationView, RunView } from "../run/types";

/** What the strip's run chips draw: the session's runs and their recipes. The cockpit puts runs into the strip. */
export function useRunStrip(sessionId: string | undefined, hostId: string | undefined) {
  const runApi = useMemo(() => createRunApi(hostFetcher(hostId ?? LOCAL_HOST_ID)), [hostId]);
  const runs = useRunStatusFeed({ sessionId: sessionId ?? "", ...(hostId ? { hostId } : {}), api: runApi });
  const [configs, setConfigs] = useState<RunConfigurationView[]>();

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    void runApi
      .configurations(sessionId)
      .then((answer) => {
        if (alive) setConfigs(answer.configurations);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runApi, sessionId]);

  const runsById = useMemo(() => {
    const map = new Map<string, RunView>();
    for (const run of runs.status?.terminals ?? []) map.set(run.runId, run);
    return map;
  }, [runs.status]);

  /** Stop or restart, then one re-read so the pressed button does not look unpressed. */
  const actOnRun = (work: () => Promise<unknown>) => {
    void work()
      .catch(() => undefined)
      .finally(() => runs.refresh());
  };

  return { runApi, runs, configs, runsById, actOnRun };
}
