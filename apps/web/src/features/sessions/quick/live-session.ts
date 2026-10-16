"use client";

import { useEffect, useRef } from "react";
import type { ConversationFollowHandle } from "@/ui/conversation";
import { useSessionSync } from "../cockpit/hooks/use-session-sync";
import { useTranscriptModel } from "../cockpit/hooks/use-transcript-model";
import { hostApi } from "./hosts";

type Decision = Parameters<ReturnType<typeof hostApi>["resolveRequest"]>[2]["decision"];

export function useLiveSession(hostId: string, sessionId: string, nudge: number) {
  const sync = useSessionSync({ hostId, sessionId, initiallyLoading: true });
  const model = useTranscriptModel(sessionId, sync);
  const follow = useRef<ConversationFollowHandle>(null);
  const { hydrate } = sync;
  useEffect(() => {
    if (nudge === 0) return;
    follow.current?.toBottom();
    hydrate();
  }, [nudge, hydrate]);
  const decide = (requestId: string, decision: Decision, extra?: { answers?: Record<string, unknown> }) =>
    void hostApi(hostId).resolveRequest(sessionId, requestId, { decision, ...(extra?.answers ? { answers: extra.answers } : {}) }).then(hydrate, () => undefined);
  return { sync, model, follow, decide };
}
