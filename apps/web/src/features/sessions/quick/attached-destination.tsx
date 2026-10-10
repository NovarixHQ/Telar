"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { ProviderIcon } from "@/features/providers";
import { Button } from "@/ui/button";
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
    <div data-slot="quick-destination" className="mx-4 overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2">
      <div className="flex items-center gap-2.5 border-b border-border/40 py-2 pr-2 pl-3">
        <span className="relative flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
          <ProviderIcon provider={session.driver} size={14} />
          <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card", statusDot(session))} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold leading-snug">{session.title || "Untitled session"}</span>
          <span className="block truncate text-2xs text-muted-foreground">{placeOf(session, manyHosts)} · {sessionStatus(session, now)}</span>
        </span>
        <Button variant="ghost" size="icon-xs" aria-label="Detach session" title="Detach (⌫ when empty)" onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <XIcon />
        </Button>
      </div>
      <LiveTranscript hostId={hostId} sessionId={session.id} live={live} height={height} />
    </div>
  );
}

export function AttachedDestination({ destination, ...card }: CardProps & { destination: Destination | null }) {
  if (!destination) return null;
  if (destination.kind === "session") return <SessionCard destination={destination} {...card} />;
  return (
    <div data-slot="quick-destination" className="mx-4 flex items-center gap-1.5 rounded-2xl border border-dashed border-border/80 bg-card py-1.5 pr-2 pl-3 text-xs text-muted-foreground shadow-2">
      <span>＋ New session in</span>
      <b className="font-semibold text-foreground">{placeOf(destination.project, card.manyHosts)}</b>
      <span>· {destination.envMode === "worktree" ? "new worktree" : "checkout"}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Clear destination" onClick={card.onClear} className="ml-auto text-muted-foreground hover:text-foreground">
        <XIcon />
      </Button>
    </div>
  );
}
