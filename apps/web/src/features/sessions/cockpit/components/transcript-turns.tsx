"use client";

import { Fragment, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { SessionChild } from "@telar/engine-client";
import type { JournalTurn } from "@/platform/engine";
import { AgentRows, bareNotificationTurn, groupNotificationTurns, ROW, SessionLookup, type SessionFacts } from "@/features/transcript";
import { cn } from "@/ui/utils";
import { sessionHref } from "../../session-list";
import { childPending } from "../hooks/use-session-children";
import type { SessionDirectory } from "../hooks/use-session-directory";

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

/** The sessions this transcript names: who its notifications came from, and its children. */
export function mentionedSessions(turns: readonly JournalTurn[], children: readonly SessionChild[]): string[] {
  const notifying = turns.flatMap((turn) => [turn.notification?.sessionId, ...(turn.notification?.entries ?? []).map((entry) => entry.sessionId)]);
  return [...new Set([...notifying, ...children.map((child) => child.sessionId)].filter((id): id is string => Boolean(id)))].sort();
}

/** Each child under the turn that tasked it; one whose turn is not loaded shows under the newest while it is still out. */
function anchorChildren(turns: readonly JournalTurn[], children: readonly SessionChild[]): Map<string, SessionChild[]> {
  const loaded = new Set(turns.map((turn) => turn.runId));
  const newest = turns.at(-1)?.runId;
  const anchored = new Map<string, SessionChild[]>();
  for (const child of children) {
    const anchor = child.parentRunId && loaded.has(child.parentRunId) ? child.parentRunId : childPending(child) ? newest : undefined;
    if (anchor) anchored.set(anchor, [...(anchored.get(anchor) ?? []), child]);
  }
  return anchored;
}

export function TranscriptTurns({ turns, activeRunId, renderTurn, directory, agents = [], hostId, projectId }: {
  turns: readonly JournalTurn[];
  directory: SessionDirectory;
  agents?: readonly SessionChild[];
  hostId?: string;
  projectId?: string;
  activeRunId?: string;
  renderTurn: (turn: JournalTurn, view: TurnView) => ReactNode;
}) {
  const known = new Map(turns.flatMap((turn) => (turn.notification?.entries ?? []).flatMap((entry) => (entry.sessionId && entry.title ? [[entry.sessionId, entry.title] as const] : []))));
  const childOf = new Map(agents.map((child) => [child.sessionId, child]));
  const lookup = (sessionId: string): SessionFacts => {
    const child = childOf.get(sessionId);
    const listed = directory.get(sessionId);
    const title = known.get(sessionId)?.trim() || child?.title?.trim() || listed?.title?.trim();
    const owner = listed?.projectId ?? (child ? projectId : undefined);
    return {
      ...(title ? { title } : {}),
      ...(owner ? { href: sessionHref({ id: sessionId, projectId: owner, ...(hostId ? { hostId } : {}) }) } : {}),
      ...(child ? { child } : {}),
    };
  };
  const anchored = anchorChildren(turns, agents);
  const titleOf = (turn: JournalTurn) => {
    const sessionId = turn.notification?.sessionId;
    return sessionId ? lookup(sessionId).title : undefined;
  };
  const row = (turn: JournalTurn) => {
    const peerTitle = titleOf(turn);
    const tasked = anchored.get(turn.runId);
    return (
      <Fragment key={turn.runId}>
        {renderTurn(turn, peerTitle ? { peerTitle } : {})}
        {tasked && (
          <div className="mx-auto w-full max-w-(--chat-content-max-width)">
            <AgentRows agents={tasked} />
          </div>
        )}
      </Fragment>
    );
  };
  const rows = (group: readonly JournalTurn[]) => {
    if (group.length > 1 && group.every((turn) => quiet(turn) && turn.runId !== activeRunId && !anchored.has(turn.runId))) {
      return <ArrivalStrip key={group[0]!.runId} titles={group.map((turn) => titleOf(turn) ?? "Untitled session")}>{group.map(row)}</ArrivalStrip>;
    }
    if (group.length === 1) return row(group[0]!);
    return (
      <div key={group[0]!.runId} className="flex flex-col gap-0.5" data-notification-strip={group.length}>
        {group.map(row)}
      </div>
    );
  };
  const drawn = groupNotificationTurns(turns, activeRunId).map(rows);
  return <SessionLookup.Provider value={lookup}>{drawn}</SessionLookup.Provider>;
}
