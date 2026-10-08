"use client";

import { useCallback, useContext } from "react";
import type { JournalItem, JournalTask } from "@telar/client/journal";
import type { AgentLive } from "../model";
import { sessionsCreated } from "../sessions-tools";
import { AgentCard, agentPending, sessionAgentView, type AgentView } from "./agent-rows";
import { TranscriptSession } from "./message-attachments";
import { SessionLookup } from "./session-lookup";
import { taskAgentView } from "./task-agent-row";
import type { RowGestures } from "./tool-row";
import { TranscriptItem } from "./transcript-item";

function useAgentView(tasks: readonly JournalTask[]): (item: JournalItem) => AgentView | undefined {
  const lookup = useContext(SessionLookup);
  const driver = useContext(TranscriptSession)?.driver;
  return useCallback(
    (item: JournalItem) => {
      if (item.detail.type === "task") {
        const taskId = item.detail.taskId;
        return taskAgentView(item, tasks.find((candidate) => candidate.id === taskId), driver);
      }
      const created = sessionsCreated(item);
      const child = created ? lookup(created)?.child : undefined;
      return child ? sessionAgentView(child, lookup(child.sessionId)) : undefined;
    },
    [tasks, lookup, driver],
  );
}

export function useAgentLive(tasks: readonly JournalTask[]): AgentLive {
  const view = useAgentView(tasks);
  return useCallback((item: JournalItem) => {
    const agent = view(item);
    return agent && agentPending(agent);
  }, [view]);
}

export function AgentCluster({ items, tasks, ...gestures }: { items: readonly JournalItem[]; tasks: readonly JournalTask[] } & RowGestures) {
  const view = useAgentView(tasks);
  return (
    <AgentCard agents={items.flatMap((item) => view(item) ?? [])}>
      {items.map((item) => <TranscriptItem key={item.id} item={item} tasks={tasks} {...gestures} />)}
    </AgentCard>
  );
}
