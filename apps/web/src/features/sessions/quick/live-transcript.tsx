"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { ConversationContent, ConversationScrollButton, ConversationTopEdge, ConversationViewport, type ConversationFollowHandle } from "@/ui/conversation";
import { SessionTurn } from "../cockpit/components/session-turn";
import { useSessionSync } from "../cockpit/hooks/use-session-sync";
import { useTranscriptModel } from "../cockpit/hooks/use-transcript-model";
import { transcriptRows } from "../cockpit/model";

const api = createEngineApi();

export function useLiveSession(sessionId: string, nudge: number) {
  const sync = useSessionSync({ hostId: LOCAL_HOST_ID, sessionId, initiallyLoading: true });
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

function useContentHeight(maxHeight: number) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = content.current;
    if (!node) return;
    const measure = () => setHeight(node.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { content, height: Math.min(Math.max(height, 40), maxHeight) };
}

export function LiveTranscript({ sessionId, live, maxHeight }: { sessionId: string; live: ReturnType<typeof useLiveSession>; maxHeight: number }) {
  const { sync, model } = live;
  const { content, height } = useContentHeight(maxHeight);
  const { shown, hostOf } = transcriptRows(model.transcript);
  const hostRun = (request: EngineRequest) => hostOf.get(request.runId) ?? request.runId;
  const decide = (requestId: string, decision: Parameters<typeof api.resolveRequest>[2]["decision"], extra?: { answers?: Record<string, unknown> }) =>
    void api.resolveRequest(sessionId, requestId, { decision, ...(extra?.answers ? { answers: extra.answers } : {}) }).then(sync.hydrate, () => undefined);

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
        <div ref={content} className="flex flex-col gap-3">
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
