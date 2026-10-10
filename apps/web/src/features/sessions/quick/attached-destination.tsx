"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/ui/utils";
import type { Destination } from "./destination";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { placeOf, sessionStatus, statusDot } from "./destination-picker";
import { LiveTranscript, useLiveSession } from "./live-transcript";

type CardProps = { nudge: number; height: number; manyHosts: boolean; onClear: () => void };

function SessionCard({ destination, nudge, height, manyHosts, onClear }: CardProps & { destination: Extract<Destination, { kind: "session" }> }) {
  const hostId = destination.session.hostId ?? LOCAL_HOST_ID;
  const live = useLiveSession(hostId, destination.session.id, nudge);
  const session = { ...destination.session, ...(live.sync.session ? { activity: live.sync.session.activity, activityDetail: live.sync.session.activityDetail, activityAt: live.sync.session.activityAt, updatedAt: live.sync.session.updatedAt, title: live.sync.session.title } : {}) };
  const [now] = useState(Date.now);
  return (
    <div data-slot="quick-destination" className="mx-4 rounded-2xl border border-border bg-popover px-3 pt-2 pb-1 text-popover-foreground shadow-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("size-2 shrink-0 rounded-full", statusDot(session))} />
        <span className="min-w-0 truncate font-semibold">{session.title}</span>
        <span className="shrink-0 text-muted-foreground">{placeOf(session, manyHosts)} · {sessionStatus(session, now)}</span>
        <button type="button" aria-label="Detach session" title="Detach (⌫ when empty)" onClick={onClear} className="ml-auto rounded-md p-0.5 text-muted-foreground hover:bg-accent">
          <XIcon className="size-3.5" />
        </button>
      </div>
      <LiveTranscript hostId={hostId} sessionId={session.id} live={live} height={height} />
    </div>
  );
}

export function AttachedDestination({ destination, ...card }: CardProps & { destination: Destination | null }) {
  if (!destination) return null;
  if (destination.kind === "session") return <SessionCard destination={destination} {...card} />;
  return (
    <div data-slot="quick-destination" className="mx-4 flex items-center gap-1.5 rounded-2xl border border-dashed border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground">
      <span>＋ New session in</span>
      <b className="font-semibold text-foreground">{placeOf(destination.project, card.manyHosts)}</b>
      <span>· {destination.envMode === "worktree" ? "new worktree" : "checkout"}</span>
      <button type="button" aria-label="Clear destination" onClick={card.onClear} className="ml-auto rounded-md p-0.5 hover:bg-accent">
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
