"use client";

import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { ConversationContent, ConversationScrollButton, ConversationTopEdge, ConversationViewport, type ConversationFollowHandle } from "@/ui/conversation";
import { SessionTurn, TurnRow } from "../cockpit/components/session-turn";
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

  const [fade, setFade] = useState<Fade>({ top: false, bottom: false });

  return (
    <ConversationViewport
      data-slot="quick-transcript"
      data-fade-top={fade.top || undefined}
      data-fade-bottom={fade.bottom || undefined}
      className="mt-2 flex-none text-xs"
      style={{ height, "--chat-content-max-width": "100%", "--fade-top": fade.top ? FADE : "0px", "--fade-bottom": fade.bottom ? FADE : "0px" } as CSSProperties}
      conversation={sync.syncKey}
      landed={sync.transcriptLanded}
      followRef={live.follow}
    >
      {(context) => (
        <>
          <FadeEdges scrollRef={context.scrollRef} atBottom={context.isAtBottom} onFade={setFade} />
          <ConversationContent
            className="gap-3 px-0 py-1 [&_.telar-markdown]:text-xs"
            scrollClassName="[mask-image:linear-gradient(to_bottom,transparent,#000_var(--fade-top),#000_calc(100%_-_var(--fade-bottom)),transparent)]"
          >
            <ConversationTopEdge more={Boolean(sync.page?.more)} loading={sync.loadingOlder} onReach={sync.loadOlder}>
              <p className="text-center text-2xs text-muted-foreground">{sync.loadingOlder ? "Loading earlier turns…" : "Scroll up for earlier turns"}</p>
            </ConversationTopEdge>
            {shown.length === 0 && <p className="text-muted-foreground">{sync.loading ? "Loading…" : "Nothing here yet."}</p>}
            {shown.map((turn) => (
              <TurnRow key={turn.runId} turn={turn} skippable={turn.runId !== model.active?.runId}>
                <SessionTurn
                  turn={turn}
                  live={turn.runId === model.active?.runId}
                  sending={false}
                  requests={model.openRequests.filter((request) => hostRun(request) === turn.runId)}
                  onDecide={decide}
                />
              </TurnRow>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </>
      )}
    </ConversationViewport>
  );
}

type Fade = { top: boolean; bottom: boolean };
const FADE = "24px";

function FadeEdges({ scrollRef, atBottom, onFade }: { scrollRef: RefObject<HTMLElement | null>; atBottom: boolean; onFade: Dispatch<SetStateAction<Fade>> }) {
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const report = () => {
      const top = element.scrollTop > 0;
      const bottom = !atBottom;
      onFade((fade) => (fade.top === top && fade.bottom === bottom ? fade : { top, bottom }));
    };
    report();
    element.addEventListener("scroll", report, { passive: true });
    return () => element.removeEventListener("scroll", report);
  }, [scrollRef, atBottom, onFade]);
  return null;
}
