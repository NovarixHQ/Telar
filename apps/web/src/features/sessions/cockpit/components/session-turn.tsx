"use client";

import { Fragment, memo, useContext, useEffect, useRef, useState } from "react";
import { ChevronRightIcon, Minimize2Icon, ShieldCheckIcon } from "lucide-react";
import type { EngineRequest, RequestDecision, SessionChild } from "@telar/engine-client";
import { isActiveTurn, isCompacting, itemText, type JournalItem, type JournalTask, type JournalTurn } from "@telar/client/journal";
import {
  AgentFinishedRow,
  AgentRows,
  agentsFinished,
  BuildersFinishedRow,
  LiveActivity,
  SessionLookup,
  Marker,
  routineNotification,
  NotificationRow,
  sessionWakeLabel,
  splitAtMessageBoundaries,
  TranscriptItem,
  turnActivity,
  typedOpening,
  TurnFailureRow,
  TurnWork,
  WorkingIndicator,
  workedForLabel,
  withoutOpeningNotification,
  AgentMarkdown,
  AgentMessageBubble,
  ConversationMessage,
  MessageActions,
} from "@/features/transcript";
import type { PanelTab } from "@/features/panel";
import { cn } from "@/ui/utils";
import { ApprovalCard } from "../../components/approval-card";
import { Message, MessageContent, MessageMenu } from "@/ui/message";
import { CodeSurface } from "@/ui/code-surface";
import { describeTurnState, wakeUpLabel } from "../model";

function WakeUpRow({ turn, roster }: { turn: JournalTurn; roster: readonly JournalTask[] }) {
  const [open, setOpen] = useState(false);
  const namedTask = turn.askedBy ?? turn.wokenBy;
  const task = namedTask ? roster.find((candidate) => candidate.id === namedTask) : undefined;
  const { verb, Icon } = turn.decidedForBackgroundWork
    ? { verb: task ? "Decided a tool call for" : "Decided a tool call for background work", Icon: ShieldCheckIcon }
    : turn.wakeReason
      ? sessionWakeLabel(turn.wakeReason)
      : wakeUpLabel(task);
  const label = turn.wakeReason
    ? `session …${turn.wakeReason.sessionId.slice(-6)}`
    : (task?.title ?? (task ? undefined : namedTask ? `task ${namedTask.slice(-6)}` : undefined));
  const body = turn.prompt.trim();
  if (task?.kind === "agent" && !turn.decidedForBackgroundWork && !turn.wakeReason && (task.state === "completed" || task.state === "failed")) {
    const name = task.title ?? task.role;
    const verb = task.state === "failed" ? "failed" : "finished";
    return <AgentFinishedRow label={name ? `Subagent “${name}” ${verb}` : `A subagent ${verb}`} failed={task.state === "failed"} />;
  }
  return (
    <div className="rounded-md">
      <div className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          disabled={!body}
          aria-expanded={body ? open : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0">{verb}</span>
          {label && <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{label}</span>}
          {body && <ChevronRightIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />}
        </button>
      </div>
      {open && body && (
        <div className="ml-3 border-l border-border/70 py-1 pr-1.5 pl-3">
          <CodeSurface text={body} wrap />
        </div>
      )}
    </div>
  );
}

type SessionTurnProps = {
  requests: EngineRequest[];
  onDecide: (requestId: string, decision: RequestDecision, extra?: { answers?: Record<string, unknown> }) => void;
  onOpenTab?: (tab: PanelTab) => void;
  onInsert?: (text: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenFileInNewTab?: (path: string) => void;
  turn: JournalTurn;
  /** The session's whole task roster: the task that woke a turn belongs to the turn that started it. */
  roster?: readonly JournalTask[];
  sending: boolean;
  live: boolean;
  onResumeNow?: () => void;
  peerTitle?: string;
  /** An open request on this turn, including the question the composer is asking. */
  awaiting?: boolean;
  builders?: readonly SessionChild[];
};

// Presence of a gesture changes the render; identity does not (the cockpit passes inline arrows).
const TURN_GESTURES = ["onOpenTab", "onInsert", "onOpenFile", "onOpenFileInNewTab", "onResumeNow"] as const;

// Compares what a turn draws, not object identity: every tail snapshot rebuilds turns as fresh objects.
// `prompt` is not compared; the engine writes it once and the runId key pins the turn.
function sameTurnRender(prev: SessionTurnProps, next: SessionTurnProps): boolean {
  if (prev.live !== next.live || prev.sending !== next.sending || prev.peerTitle !== next.peerTitle || prev.awaiting !== next.awaiting) return false;
  if (!sameEach(prev.builders ?? [], next.builders ?? [], (a, b) => a.sessionId === b.sessionId && a.state === b.state && a.summary === b.summary && a.title === b.title)) return false;
  for (const gesture of TURN_GESTURES) if (Boolean(prev[gesture]) !== Boolean(next[gesture])) return false;
  if (!sameEach(prev.requests, next.requests, (a, b) => a.id === b.id && a.state === b.state && a.decision === b.decision)) return false;
  // Only the wake-up row reads the roster, and only on a turn that names the task that woke it.
  const rosterRead = (next.turn.wokenBy ?? next.turn.askedBy) !== undefined;
  if (rosterRead && !sameEach(prev.roster ?? [], next.roster ?? [], (a, b) => a.id === b.id && a.title === b.title && a.kind === b.kind)) return false;
  return sameTurnContent(prev.turn, next.turn);
}

function sameEach<T>(prev: readonly T[], next: readonly T[], same: (before: T, after: T) => boolean): boolean {
  if (prev === next) return true;
  return prev.length === next.length && prev.every((before, index) => before === next[index] || same(before, next[index]!));
}

/** Every field of a turn the body branches on or prints. */
function sameTurnContent(prev: JournalTurn, next: JournalTurn): boolean {
  if (prev === next) return true;
  return (
    prev.runId === next.runId &&
    prev.state === next.state &&
    prev.held === next.held &&
    prev.heldReason === next.heldReason &&
    prev.kind === next.kind &&
    prev.origin === next.origin &&
    prev.wokenBy === next.wokenBy &&
    prev.askedBy === next.askedBy &&
    prev.decidedForBackgroundWork === next.decidedForBackgroundWork &&
    prev.wakeReason?.kind === next.wakeReason?.kind &&
    prev.wakeReason?.sessionId === next.wakeReason?.sessionId &&
    prev.sender?.sessionId === next.sender?.sessionId &&
    prev.agentDelivery === next.agentDelivery &&
    prev.agentIntent === next.agentIntent &&
    prev.agentNotice === next.agentNotice &&
    prev.notification?.summary === next.notification?.summary &&
    prev.notification?.deliveries === next.notification?.deliveries &&
    prev.assignmentScope === next.assignmentScope &&
    prev.attachments?.length === next.attachments?.length &&
    prev.startedAt === next.startedAt &&
    prev.lastActivityAt === next.lastActivityAt &&
    prev.resultText === next.resultText &&
    prev.failure === next.failure &&
    prev.failureCode === next.failureCode &&
    prev.failureDetail === next.failureDetail &&
    prev.resumeAt === next.resumeAt &&
    prev.limitType === next.limitType &&
    prev.resumedAfterRateLimit === next.resumedAfterRateLimit &&
    prev.usage?.tokens.input === next.usage?.tokens.input &&
    prev.usage?.tokens.output === next.usage?.tokens.output &&
    sameItems(prev.items, next.items) &&
    sameTurnTasks(prev.tasks, next.tasks)
  );
}

function sameItems(prev: readonly JournalItem[], next: readonly JournalItem[]): boolean {
  return sameEach(prev, next, (before, after) =>
    before.id === after.id &&
    before.status === after.status &&
    before.taskId === after.taskId &&
    (before.detail === after.detail || (after.status !== "inProgress" && before.detail.type === after.detail.type)) &&
    itemText(before) === itemText(after));
}

function sameTurnTasks(prev: readonly JournalTask[], next: readonly JournalTask[]): boolean {
  return sameEach(prev, next, (before, after) =>
    before.id === after.id &&
    before.state === after.state &&
    before.kind === after.kind &&
    before.title === after.title &&
    before.backgrounded === after.backgrounded &&
    before.resultText === after.resultText &&
    before.failure === after.failure &&
    sameItems(before.items, after.items));
}

export const SessionTurn = memo(SessionTurnBody, sameTurnRender);

function SessionTurnBody({
  turn,
  requests,
  sending,
  live,
  onDecide,
  onOpenTab,
  onResumeNow,
  onInsert,
  onOpenFile,
  onOpenFileInNewTab,
  roster = [],
  peerTitle,
  awaiting = false,
  builders = [],
}: SessionTurnProps) {
  const doing = turnActivity(turn);
  const finished = useAgentsFinished(turn);
  const rowGestures = {
    ...(onInsert ? { onInsert } : {}),
    ...(onOpenFile ? { onOpenFile } : {}),
    ...(onOpenFileInNewTab ? { onOpenFileInNewTab } : {}),
  };
  const responses = splitAtMessageBoundaries(withoutOpeningNotification(turn));
  const answering = responses.at(-1)!;
  const earlier = responses.slice(0, -1);
  // Only the last response's final assistant message is the answer to the turn.
  const lastProse = answering.items.map((item) => item.detail.type).lastIndexOf("assistant_message");
  const answer = lastProse === -1 ? undefined : answering.items[lastProse];
  const activity = answering.items.filter((item) => item !== answer);
  const streamedAnswer = Boolean(answer && itemText(answer));
  const answerLane =
    live ||
    builders.length > 0 ||
    requests.length > 0 ||
    answering.items.length > 0 ||
    Boolean(turn.resultText) ||
    Boolean(turn.failure) ||
    Boolean(turn.usage) ||
    turn.resumedAfterRateLimit !== undefined ||
    turn.restartOrigin !== undefined ||
    turn.state === "stopped" ||
    turn.state === "discarded" ||
    turn.state === "failed";

  if (turn.kind === "compact") return <CompactTurn turn={turn} rowGestures={rowGestures} />;
  const opening = foldsOpening(turn, Boolean(finished)) && !live && answerLane ? <NotificationRow detail={turn.notification!} {...(turn.sender ? { message: turn.prompt } : {})} {...(peerTitle ? { title: peerTitle } : {})} /> : undefined;
  const boundary = (item: JournalItem) => (
    <div className={cn("mx-auto w-full min-w-0 max-w-(--chat-content-max-width)", item.detail.type === "user_message" && !item.detail.sender && !item.detail.wakeReason && "my-6")}>
      <TranscriptItem item={item} tasks={turn.tasks} {...rowGestures} {...(onOpenTab ? { onOpenTab } : {})} />
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {!opening && <TurnOpening turn={turn} roster={roster} {...rowGestures} {...(onOpenTab ? { onOpenTab } : {})} {...(peerTitle ? { peerTitle } : {})} />}

      {earlier.map((response) => (
        <Fragment key={response.boundary?.id ?? "opening"}>
          {response.boundary && boundary(response.boundary)}
          {response.items.length > 0 && (
            <Message from="assistant">
              <MessageContent from="assistant">
                <LiveActivity items={response.items} tasks={turn.tasks} liveTail={false} {...rowGestures} />
              </MessageContent>
            </Message>
          )}
        </Fragment>
      ))}
      {answering.boundary && boundary(answering.boundary)}

      {answerLane && (
      <Message from="assistant">
        <MessageContent from="assistant">
          {turn.restartOrigin !== undefined && <Marker>continued after Telar restarted to update</Marker>}
          {requests.map((request) => (
            <ApprovalCard key={request.id} request={request} sending={sending} onDecide={onDecide} />
          ))}
          {live ? (
            // Only the answering response's items, so live and settled cut the turn in the same place.
            <LiveActivity items={answering.items} tasks={turn.tasks} {...rowGestures} />
          ) : (
            <>
              <TurnWork
                items={activity}
                tasks={turn.tasks}
                label={workedForLabel(turn.startedAt, turn.endedAt)}
                {...(turn.usage ? { detail: `${(turn.usage.tokens.input + turn.usage.tokens.output).toLocaleString()} tokens` } : {})}
                {...(opening ? { lead: opening } : {})}
                {...(builders.length ? { trail: <AgentRows agents={builders} /> } : {})}
                {...rowGestures}
              />
              {answer && <TranscriptItem item={answer} tasks={turn.tasks} meta {...rowGestures} />}
            </>
          )}
          {!streamedAnswer && turn.resultText && <AgentMarkdown text={turn.resultText} onOpenFile={onOpenFile} />}
          {turn.failure && (
            <TurnFailureRow
              failure={turn.failure}
              {...(turn.failureCode ? { code: turn.failureCode } : {})}
              {...(turn.failureDetail ? { detail: turn.failureDetail } : {})}
              {...(turn.resumeAt === undefined ? {} : { resumeAt: turn.resumeAt })}
              {...(turn.limitType ? { limitType: turn.limitType } : {})}
              {...(onResumeNow ? { onResume: onResumeNow, resuming: sending } : {})}
            />
          )}
          {turn.resumedAfterRateLimit !== undefined && <Marker>resumed after the usage limit reset</Marker>}
          {turn.state === "stopped" && <Marker>stopped — kept what arrived</Marker>}
          {turn.state === "discarded" && <Marker>{describeTurnState(turn.state).label.toLowerCase()}</Marker>}
          {live && (
            <WorkingIndicator
              label={doing.label}
              delegated={doing.delegated}
              compacting={isCompacting(turn)}
              awaiting={awaiting}
              startedAt={turn.startedAt}
              {...(turn.lastActivityAt ? { lastActivityAt: turn.lastActivityAt } : {})}
            />
          )}
          {turn.state === "failed" && !turn.failure && <p className="mt-2 text-sm text-muted-foreground">This turn ended early. Your history is saved; send a new message to continue.</p>}
        </MessageContent>
      </Message>
      )}
    </div>
  );
}

type RowGestures = Pick<SessionTurnProps, "onInsert" | "onOpenFile" | "onOpenFileInNewTab">;

// A compaction is one quiet system line, not a "/compact" bubble with an empty reply.
function CompactTurn({ turn, rowGestures }: { turn: JournalTurn; rowGestures: RowGestures }) {
  return (
    <div className="flex flex-col gap-2">
      {turn.items.filter((item) => item.detail.type === "context_compaction").map((item) => (
        <TranscriptItem key={item.id} item={item} {...rowGestures} />
      ))}
      {turn.items.every((item) => item.detail.type !== "context_compaction") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Minimize2Icon className="size-3.5 shrink-0" />
          <span>
            {isActiveTurn(turn.state)
                ? "Compacting context…"
                : turn.state === "failed"
                  ? "Compaction failed"
                  : "Context compaction requested"}
          </span>
        </p>
      )}
      {turn.state === "failed" && turn.failure && <p className="text-xs text-destructive">{turn.failure}</p>}
    </div>
  );
}

function TurnOpening({
  turn,
  roster,
  onInsert,
  onOpenTab,
  peerTitle,
}: RowGestures & { turn: JournalTurn; roster: readonly JournalTask[]; onOpenTab?: (tab: PanelTab) => void; peerTitle?: string }) {
  const finished = useAgentsFinished(turn);
  return (
    <>
      {typedOpening(turn) && (
        // `markdown={false}`: the typed draft is not Markdown, so "Copy as Markdown" would mislabel it.
        <MessageMenu text={turn.prompt} markdown={false} {...(onInsert ? { onQuote: onInsert } : {})}>
          <div className="group/message">
            <ConversationMessage
              text={turn.prompt}
              {...(turn.attachments ? { attachments: turn.attachments } : {})}
              {...(onOpenTab ? { onOpenTab } : {})}
              footer={<MessageActions text={turn.prompt} at={turn.acceptedAt} align="end" />}
            />
          </div>
        </MessageMenu>
      )}

      {/* The initiating machine message precedes every response and steer. */}
      {(turn.origin === "provider" || turn.origin === "session") && (
        <Message from="assistant"><MessageContent from="assistant">
          {finished ? (
            <BuildersFinishedRow finished={finished} {...(peerTitle ? { fallbackTitle: peerTitle } : {})} />
          ) : turn.notification ? (
            <NotificationRow detail={turn.notification} {...(turn.sender ? { message: turn.prompt } : {})} {...(peerTitle ? { title: peerTitle } : {})} />
          ) : turn.origin === "session" && turn.sender ? (
            <AgentMessageBubble text={turn.prompt} sender={turn.sender} {...(turn.agentNotice ? { notice: turn.agentNotice } : {})} {...(turn.agentIntent ? { intent: turn.agentIntent } : {})} {...(turn.assignmentScope ? { scope: turn.assignmentScope } : {})} {...(turn.attachments ? { attachments: turn.attachments } : {})} {...(onOpenTab ? { onOpenTab } : {})} />
          ) : (
            <WakeUpRow turn={turn} roster={roster} />
          )}
        </MessageContent></Message>
      )}
    </>
  );
}

function useAgentsFinished(turn: JournalTurn) {
  const lookup = useContext(SessionLookup);
  return turn.notification ? agentsFinished(turn.notification, (sessionId) => Boolean(lookup(sessionId)?.child)) : undefined;
}

function foldsOpening(turn: JournalTurn, finished: boolean): boolean {
  return Boolean(turn.notification) && (turn.origin === "provider" || turn.origin === "session") && routineNotification(turn.notification!) && !finished;
}

// Lets the browser skip rendering an off-screen settled turn, at the height it last rendered.
export function TurnFrame({ skippable, children }: { skippable: boolean; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    if (!skippable) {
      element.style.removeProperty("content-visibility");
      element.style.removeProperty("contain-intrinsic-size");
      return;
    }
    // Measured once: a later reading would measure the skipped placeholder.
    if (element.style.getPropertyValue("content-visibility")) return;
    const measured = element.offsetHeight;
    if (!measured) return;
    element.style.setProperty("content-visibility", "auto");
    element.style.setProperty("contain-intrinsic-size", `auto ${measured}px`);
  }, [skippable]);
  return <div ref={frame}>{children}</div>;
}

export function TurnRow({ turn, skippable, marker, children }: { turn: JournalTurn; skippable: boolean; marker?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("relative", typedOpening(turn) && "not-first:pt-5")}>
      <TurnFrame skippable={skippable}>{children}</TurnFrame>
      {marker}
    </div>
  );
}

export function EmptyTranscript({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading session" className="mx-auto w-full max-w-(--chat-content-max-width) space-y-6 py-6">
        <div className="ml-auto h-10 w-2/5 animate-pulse rounded-md bg-muted/60" />
        <div className="space-y-2">
          <div className="h-4 w-11/12 animate-pulse rounded-md bg-muted/60" />
          <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted/60" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
      <p className="text-sm font-medium">Ready for its first turn</p>
      <p className="text-sm text-muted-foreground">Ask for changes, or explore the project.</p>
    </div>
  );
}
