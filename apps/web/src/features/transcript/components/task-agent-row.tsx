"use client";

import { useContext } from "react";
import type { SessionChildState } from "@telar/engine-client";
import { itemLabel, type JournalItem, type JournalTask } from "@/platform/engine";
import { MessageMenu, MessageResponse } from "@/ui/message";
import { LiveActivity } from "./activity";
import { AgentDisclosure, type AgentView } from "./agent-rows";
import { TranscriptSession } from "./message-attachments";
import type { RowGestures } from "./tool-row";

const STATE: Record<JournalTask["state"], SessionChildState> = {
  pending: "working",
  running: "working",
  waiting: "waiting",
  completed: "done",
  failed: "failed",
  stopped: "stopped",
};

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split("\n").find((candidate) => candidate.trim());
  return line?.replace(/^[\s#>*-]+/, "").replace(/[`*_]/g, "").trim() || undefined;
}

function viewOf(item: JournalItem, task: JournalTask | undefined, driver: AgentView["provider"]): AgentView {
  const state = task ? STATE[task.state] : item.status === "inProgress" ? "working" : item.status === "failed" ? "failed" : "done";
  const last = task?.items.at(-1);
  const line = state === "working" ? (last ? itemLabel(last) : undefined) : firstLine(task?.failure ?? task?.resultText);
  const completedAt = task?.completedAt ?? item.completedAt;
  return {
    state,
    title: task?.title ?? item.title ?? task?.role ?? "Sub-agent",
    ...(task?.role && task.role !== task.title ? { role: task.role } : {}),
    ...(line ? { line } : {}),
    ...(driver ? { provider: driver } : {}),
    startedAt: task?.startedAt ?? item.startedAt,
    ...(completedAt === undefined ? {} : { endedAt: completedAt }),
  };
}

export function TaskAgentRow({ item, task, tasks, ...gestures }: { item: JournalItem; task: JournalTask | undefined; tasks: readonly JournalTask[] } & RowGestures) {
  const driver = useContext(TranscriptSession)?.driver;
  const view = viewOf(item, task, driver);
  const steps = task?.items ?? [];
  const report = task?.failure ?? task?.resultText;
  const opens = steps.length > 0 || Boolean(report);
  const row = (
    <AgentDisclosure agent={view}>
      {opens && (
        <>
          {steps.length > 0 && <LiveActivity items={steps} tasks={[...tasks]} liveTail={view.state === "working"} {...gestures} />}
          {task?.failure ? <p className="text-xs text-destructive">{task.failure}</p> : report && <MessageResponse>{report}</MessageResponse>}
        </>
      )}
    </AgentDisclosure>
  );
  if (!report) return row;
  return (
    <MessageMenu text={report} {...(gestures.onInsert ? { onQuote: gestures.onInsert } : {})}>
      {row}
    </MessageMenu>
  );
}
