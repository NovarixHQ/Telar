"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_TEXT_GEN_POLICY, type TextGenPolicy } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";

const api = createEngineApi();

export type TextGenPatch = Parameters<typeof api.setTextGen>[0];

export function useTextGenPolicy() {
  const [policy, setPolicy] = useState<TextGenPolicy>(DEFAULT_TEXT_GEN_POLICY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const task = window.setTimeout(() => {
      void api
        .textGen()
        .then(({ textGen }) => setPolicy(textGen))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The engine did not answer."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const save = useCallback(async (patch: TextGenPatch) => {
    setError(undefined);
    try {
      const { textGen } = await api.setTextGen(patch);
      setPolicy(textGen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The engine refused the change.");
    }
  }, []);

  return { policy, loading, error, save };
}
