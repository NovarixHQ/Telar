"use client";

import { useCallback, useState } from "react";
import type { SimulatorsState } from "@telar/engine-client";
import { usePoll } from "@/ui/hooks/use-poll";
import type { SimulatorsApi } from "../api";

const SETTLING_MS = 1_000;
const READY_MS = 3_000;

export function useSimulators(api: SimulatorsApi, visible: boolean) {
  const [state, setState] = useState<SimulatorsState>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      setState((await api.simulators()).simulators);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The engine did not answer.");
    }
  }, [api]);
  const settling = state === undefined || state.status === "installing" || state.status === "starting" || state.status === "idle";
  usePoll(refresh, visible ? (settling ? SETTLING_MS : READY_MS) : null);
  return { state, error, refresh };
}
