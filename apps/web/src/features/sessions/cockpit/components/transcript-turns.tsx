"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { JournalTurn } from "@/platform/engine";
import { bareNotificationTurn, groupNotificationTurns, ROW, SessionTitles } from "@/features/transcript";
import { cn } from "@/ui/utils";
import type { SessionDirectory } from "../hooks/use-session-directory";
import { CohortFold, foldCohortTurns } from "./cohort-fold";

export type TurnView = { peerTitle?: string };

function quiet(turn: JournalTurn): boolean {
  const detail = turn.notification;
  if (!detail || !bareNotificationTurn(turn) || turn.state !== "completed") return false;
  return ![detail, ...(detail.entries ?? [])].some((each) => each.kind === "request" || each.wakeKind === "request_opened" || each.intent === "blocker" || each.intent === "task" || each.wakeKind === "turn_failed");
}

function ArrivalStrip({ titles, children }: { titles: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const named = [...new Set(titles)];
  return (
    <div className="mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-0.5" data-notification-strip={titles.length}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={cn(ROW, "text-muted-foreground hover:bg-muted/50")}>
        <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 truncate">{`${titles.length} updates · ${named.join(", ")}`}</span>
      </button>
      {open && children}
    </div>
  );
}

/** The sessions this transcript's notifications came from, so the cockpit can name them. */
export function notifyingSessions(turns: readonly JournalTurn[]): string[] {
  return [...new Set(turns.flatMap((turn) => [turn.notification?.sessionId, ...(turn.notification?.entries ?? []).map((entry) => entry.sessionId)]).filter((id): id is string => Boolean(id)))].sort();
}

export function TranscriptTurns({ turns, activeRunId, keep, renderTurn, directory }: {
  turns: readonly JournalTurn[];
  directory: SessionDirectory;
  activeRunId?: string;
  keep: ReadonlySet<string>;
  renderTurn: (turn: JournalTurn, view: TurnView) => ReactNode;
}) {
  const segments = foldCohortTurns(turns, { ...(activeRunId ? { activeRunId } : {}), keep });
  const known = new Map(turns.flatMap((turn) => (turn.notification?.entries ?? []).flatMap((entry) => (entry.sessionId && entry.title ? [[entry.sessionId, entry.title] as const] : []))));
  const title = (sessionId: string) => known.get(sessionId)?.trim() || directory.get(sessionId)?.title?.trim();
  const titleOf = (turn: JournalTurn) => {
    const sessionId = turn.notification?.sessionId;
    return sessionId ? title(sessionId) : undefined;
  };
  const row = (turn: JournalTurn) => {
    const peerTitle = titleOf(turn);
    return <Fragment key={turn.runId}>{renderTurn(turn, peerTitle ? { peerTitle } : {})}</Fragment>;
  };
  const rows = (group: readonly JournalTurn[]) => {
    if (group.length > 1 && group.every((turn) => quiet(turn) && turn.runId !== activeRunId)) {
      return <ArrivalStrip key={group[0]!.runId} titles={group.map((turn) => titleOf(turn) ?? "Untitled session")}>{group.map(row)}</ArrivalStrip>;
    }
    if (group.length === 1) return row(group[0]!);
    return (
      <div key={group[0]!.runId} className="flex flex-col gap-0.5" data-notification-strip={group.length}>
        {group.map(row)}
      </div>
    );
  };
  const drawn = segments.map((segment) => {
    const groups = groupNotificationTurns(segment.turns, activeRunId);
    if (segment.kind === "turns") return <Fragment key={segment.turns[0]!.runId}>{groups.map(rows)}</Fragment>;
    return (
      <CohortFold key={segment.turns[0]!.runId} turns={segment.turns} members={segment.members}>
        {groups.map(rows)}
      </CohortFold>
    );
  });
  return <SessionTitles.Provider value={title}>{drawn}</SessionTitles.Provider>;
}
