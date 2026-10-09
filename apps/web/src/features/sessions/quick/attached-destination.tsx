"use client";

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { createEngineApi } from "@/platform/engine";
import { MessageResponse } from "@/ui/message";
import { cn } from "@/ui/utils";
import type { Destination } from "./destination";
import { sessionStatus, statusDot } from "./destination-picker";

const api = createEngineApi();

function useLastReply(sessionId: string) {
  const [reply, setReply] = useState<{ sessionId: string; text: string }>();
  useEffect(() => {
    let live = true;
    void api.turnAnswer(sessionId, { limit: 8000 }).then((answer) => live && setReply({ sessionId, text: answer.text }), () => undefined);
    return () => {
      live = false;
    };
  }, [sessionId]);
  return reply?.sessionId === sessionId ? reply.text : "";
}

function SessionCard({ destination, onClear }: { destination: Extract<Destination, { kind: "session" }>; onClear: () => void }) {
  const { session, projectName } = destination;
  const reply = useLastReply(session.id);
  const [open, setOpen] = useState(false);
  const [now] = useState(Date.now);
  return (
    <div data-slot="quick-destination" className="mx-7 rounded-t-xl border border-b-0 border-border bg-popover px-3 pt-2 pb-2.5 text-popover-foreground shadow-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("size-2 shrink-0 rounded-full", statusDot(session))} />
        <span className="min-w-0 truncate font-semibold">{session.title}</span>
        <span className="shrink-0 text-muted-foreground">{projectName} · {sessionStatus(session, now)}</span>
        <button type="button" aria-label="Detach session" title="Detach (⌫ when empty)" onClick={onClear} className="ml-auto rounded-md p-0.5 text-muted-foreground hover:bg-accent">
          <XIcon className="size-3.5" />
        </button>
      </div>
      {reply && (
        <>
          <div
            data-slot="quick-reply"
            className={cn(
              "relative mt-2 text-xs",
              open ? "max-h-72 overflow-y-auto" : "max-h-16 overflow-hidden after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-linear-to-b after:from-transparent after:to-popover",
            )}
          >
            <MessageResponse>{reply}</MessageResponse>
          </div>
          <button type="button" onClick={() => setOpen(!open)} className="mt-1.5 text-2xs text-primary hover:underline">
            {open ? "Collapse" : "Show full reply"}
          </button>
        </>
      )}
    </div>
  );
}

export function AttachedDestination({ destination, onClear }: { destination: Destination | null; onClear: () => void }) {
  if (!destination) return null;
  if (destination.kind === "session") return <SessionCard destination={destination} onClear={onClear} />;
  return (
    <div data-slot="quick-destination" className="mx-7 flex items-center gap-1.5 rounded-t-xl border border-b-0 border-dashed border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground">
      <span>＋ New session in</span>
      <b className="font-semibold text-foreground">{destination.project.name ?? destination.project.id}</b>
      <span>· {destination.envMode === "worktree" ? "new worktree" : "checkout"}</span>
      <button type="button" aria-label="Clear destination" onClick={onClear} className="ml-auto rounded-md p-0.5 hover:bg-accent">
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
