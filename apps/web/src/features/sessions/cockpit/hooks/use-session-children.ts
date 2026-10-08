"use client";

import { useRef, useState } from "react";
import { displayToolName, type SessionChild } from "@telar/engine-client";
import { createEngineApi, type JournalTurn } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { usePoll } from "@/ui/hooks/use-poll";

export const CHILDREN_LIVE_MS = 3_000;
export const CHILDREN_IDLE_MS = 15_000;

const NONE: readonly SessionChild[] = [];

export const childPending = (child: Pick<SessionChild, "state">): boolean => child.state === "working" || child.state === "waiting";

/** The sessions `sessionId` tasked, oldest first. Polled faster while any is out; a new `growth` refetches at once. */
export function useSessionChildren(hostId: string, sessionId: string | undefined, growth: unknown): readonly SessionChild[] {
  const owner = sessionId ? `${hostId}:${sessionId}` : undefined;
  const [held, setHeld] = useState<{ owner: string; children: SessionChild[] }>();
  const children = held && held.owner === owner ? held.children : NONE;
  const lastRead = useRef<{ key: string; at: number }>(undefined);
  const key = `${owner}:${String(growth)}`;
  usePoll(
    async (signal) => {
      if (!sessionId || !owner) return;
      const quiet = !children.some(childPending);
      if (quiet && lastRead.current?.key === key && Date.now() - lastRead.current.at < CHILDREN_IDLE_MS) return;
      lastRead.current = { key, at: Date.now() };
      const answer = await createEngineApi(hostFetcher(hostId)).children(sessionId).catch(() => undefined);
      if (Array.isArray(answer?.children) && !signal.aborted) setHeld({ owner, children: answer.children });
    },
    owner ? CHILDREN_LIVE_MS : null,
    { key },
  );
  return children;
}

export function childrenGrowth(turns: readonly JournalTurn[]): string {
  const calls = (turns.at(-1)?.items ?? []).filter(
    (item) => item.detail.type === "mcp_tool_call" && item.status !== "inProgress" && displayToolName(item.detail.call.name).startsWith("sessions_"),
  ).length;
  return `${turns.length}:${calls}`;
}
