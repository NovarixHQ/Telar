"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/ui/utils";
import type { Destination } from "./destination";
import { sessionStatus, statusDot } from "./destination-picker";
import { LiveTranscript } from "./live-transcript";

function SessionCard({ destination, nudge, onClear }: { destination: Extract<Destination, { kind: "session" }>; nudge: number; onClear: () => void }) {
  const { session, projectName } = destination;
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
      <LiveTranscript sessionId={session.id} nudge={nudge} />
    </div>
  );
}

export function AttachedDestination({ destination, nudge, onClear }: { destination: Destination | null; nudge: number; onClear: () => void }) {
  if (!destination) return null;
  if (destination.kind === "session") return <SessionCard destination={destination} nudge={nudge} onClear={onClear} />;
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
