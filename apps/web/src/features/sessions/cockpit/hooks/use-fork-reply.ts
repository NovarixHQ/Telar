"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { EngineApiError } from "@/platform/engine";
import { asEngineError, createEngineApi } from "@/platform/engine";
import { focusComposerFor } from "@/features/composer";
import { sessionHref } from "../../session-list";

const api = createEngineApi();

export function useForkReply(sessionId: string | undefined, hostId: string, setError: (error: EngineApiError | undefined) => void) {
  const router = useRouter();
  return useCallback(
    async (runId: string) => {
      if (!sessionId) return;
      try {
        const { session } = await api.forkSession(sessionId, runId);
        focusComposerFor(session.id);
        router.push(sessionHref({ id: session.id, projectId: session.projectId, hostId }));
      } catch (cause) {
        setError(asEngineError(cause, "Could not fork the session."));
      }
    },
    [sessionId, hostId, router, setError],
  );
}
