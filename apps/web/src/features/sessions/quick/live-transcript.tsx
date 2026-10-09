"use client";

import { useEffect, type CSSProperties } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { ConversationContent, ConversationScrollButton, ConversationViewport } from "@/ui/conversation";
import { SessionTurn } from "../cockpit/components/session-turn";
import { useSessionSync } from "../cockpit/hooks/use-session-sync";
import { useTranscriptModel } from "../cockpit/hooks/use-transcript-model";
import { transcriptRows } from "../cockpit/model";

const api = createEngineApi();
const SHOWN_TURNS = 2;
const COMPACT = { "--chat-content-max-width": "100%" } as CSSProperties;

export function LiveTranscript({ sessionId, nudge }: { sessionId: string; nudge: number }) {
  const sync = useSessionSync({ hostId: LOCAL_HOST_ID, sessionId, initiallyLoading: true });
  const model = useTranscriptModel(sessionId, sync);
  const { hydrate } = sync;
  useEffect(() => {
    if (nudge > 0) hydrate();
  }, [nudge, hydrate]);

  const { shown, hostOf } = transcriptRows(model.transcript);
  const hostRun = (request: EngineRequest) => hostOf.get(request.runId) ?? request.runId;
  const decide = (requestId: string, decision: Parameters<typeof api.resolveRequest>[2]["decision"], extra?: { answers?: Record<string, unknown> }) =>
    void api.resolveRequest(sessionId, requestId, { decision, ...(extra?.answers ? { answers: extra.answers } : {}) }).then(hydrate, () => undefined);

  return (
    <ConversationViewport data-slot="quick-transcript" className="mt-2 max-h-72 min-h-0 text-xs" style={COMPACT} conversation={sync.syncKey} landed={sync.transcriptLanded}>
      <ConversationContent className="gap-3 px-0 py-1 [&_.telar-markdown]:text-xs">
        {shown.length === 0 && <p className="text-muted-foreground">{sync.loading ? "Loading…" : "Nothing here yet."}</p>}
        {shown.slice(-SHOWN_TURNS).map((turn) => (
          <SessionTurn
            key={turn.runId}
            turn={turn}
            live={turn.runId === model.active?.runId}
            sending={false}
            requests={model.openRequests.filter((request) => hostRun(request) === turn.runId)}
            onDecide={decide}
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </ConversationViewport>
  );
}
