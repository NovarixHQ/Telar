"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { ConversationContent, ConversationScrollButton, ConversationTopEdge, ConversationViewport, type ConversationFollowHandle } from "@/ui/conversation";
import { SessionTurn } from "../cockpit/components/session-turn";
import { useSessionSync } from "../cockpit/hooks/use-session-sync";
import { useTranscriptModel } from "../cockpit/hooks/use-transcript-model";
import { transcriptRows } from "../cockpit/model";
import { hostApi } from "./hosts";


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
  return { sync, model, follow };
}

export function LiveTranscript({ hostId, sessionId, live, height }: { hostId: string; sessionId: string; live: ReturnType<typeof useLiveSession>; height: number }) {
  const { sync, model } = live;
  const { shown, hostOf } = transcriptRows(model.transcript);
  const hostRun = (request: EngineRequest) => hostOf.get(request.runId) ?? request.runId;
  const decide = (requestId: string, decision: Parameters<ReturnType<typeof hostApi>["resolveRequest"]>[2]["decision"], extra?: { answers?: Record<string, unknown> }) =>
    void hostApi(hostId).resolveRequest(sessionId, requestId, { decision, ...(extra?.answers ? { answers: extra.answers } : {}) }).then(sync.hydrate, () => undefined);

  return (
    <ConversationViewport
      data-slot="quick-transcript"
      className="mt-2 flex-none text-xs"
      style={{ height, "--chat-content-max-width": "100%" } as CSSProperties}
      conversation={sync.syncKey}
      landed={sync.transcriptLanded}
      followRef={live.follow}
    >
      <ConversationContent className="gap-0 px-0 py-1 [&_.telar-markdown]:text-xs">
        <div className="flex flex-col gap-3">
          <ConversationTopEdge more={Boolean(sync.page?.more)} loading={sync.loadingOlder} onReach={sync.loadOlder}>
            <p className="text-center text-2xs text-muted-foreground">{sync.loadingOlder ? "Loading earlier turns…" : "Scroll up for earlier turns"}</p>
          </ConversationTopEdge>
          {shown.length === 0 && <p className="text-muted-foreground">{sync.loading ? "Loading…" : "Nothing here yet."}</p>}
          {shown.map((turn) => (
            <SessionTurn
              key={turn.runId}
              turn={turn}
              live={turn.runId === model.active?.runId}
              sending={false}
              requests={model.openRequests.filter((request) => hostRun(request) === turn.runId)}
              onDecide={decide}
            />
          ))}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
    </ConversationViewport>
  );
}
