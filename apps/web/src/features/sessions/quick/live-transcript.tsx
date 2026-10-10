"use client";

import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { ConversationContent, ConversationScrollButton, ConversationTopEdge, ConversationViewport, type ConversationFollowHandle } from "@/ui/conversation";
import { MessageSquareIcon } from "lucide-react";
import { typedOpening } from "@/features/transcript";
import { cn } from "@/ui/utils";
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

  const [fade, setFade] = useState<Fade>({ top: false, bottom: false });

  return (
    <ConversationViewport
      data-slot="quick-transcript"
      data-fade-top={fade.top || undefined}
      data-fade-bottom={fade.bottom || undefined}
      className="flex-none text-xs"
      style={{ height, "--chat-content-max-width": "100%", "--fade-top": fade.top ? FADE : "0px", "--fade-bottom": fade.bottom ? FADE : "0px" } as CSSProperties}
      conversation={sync.syncKey}
      landed={sync.transcriptLanded}
      followRef={live.follow}
    >
      {(context) => (
        <>
          <FadeEdges scrollRef={context.scrollRef} atBottom={context.isAtBottom} onFade={setFade} />
          <ConversationContent
            className="gap-2 px-3 py-2"
            scrollClassName="[mask-image:linear-gradient(to_bottom,transparent,#000_var(--fade-top),#000_calc(100%_-_var(--fade-bottom)),transparent)]"
          >
            <ConversationTopEdge more={Boolean(sync.page?.more)} loading={sync.loadingOlder} onReach={sync.loadOlder}>
              <p className="text-center text-2xs text-muted-foreground">{sync.loadingOlder ? "Loading earlier turns…" : "Scroll up for earlier turns"}</p>
            </ConversationTopEdge>
            {shown.length === 0 && <EmptyState loading={sync.loading} />}
            {shown.map((turn) => (
              <div key={turn.runId} className={cn(typedOpening(turn) && "not-first:pt-2")}>
                <SessionTurn
                  turn={turn}
                  live={turn.runId === model.active?.runId}
                  sending={false}
                  requests={model.openRequests.filter((request) => hostRun(request) === turn.runId)}
                  onDecide={decide}
                />
              </div>
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

function EmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading conversation" className="flex flex-col gap-2 py-2">
        <div className="ml-auto h-7 w-2/5 animate-pulse rounded-lg bg-muted/60" />
        <div className="h-3 w-11/12 animate-pulse rounded-md bg-muted/60" />
        <div className="h-3 w-2/3 animate-pulse rounded-md bg-muted/60" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5 py-10 text-muted-foreground">
      <MessageSquareIcon className="size-4" />
      <p className="text-xs">No messages yet</p>
    </div>
  );
}
