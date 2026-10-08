"use client";

import { useRef, useState } from "react";
import { displayToolName, type SessionChild } from "@telar/engine-client";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { type JournalTurn } from "@telar/client/journal";
import { hostFetcher } from "@/platform/engine/host-client";
import { usePoll } from "@/ui/hooks/use-poll";
import { changesRow, useSessionsStream } from "../../sessions-stream";

export const CHILDREN_LIVE_MS = 3_000;
export const CHILDREN_IDLE_MS = 15_000;

const NONE: readonly SessionChild[] = [];
const unsupported = new Set<string>();

export const childPending = (child: Pick<SessionChild, "state">): boolean => child.state === "working" || child.state === "waiting";

/** The sessions `sessionId` tasked, oldest first. Polled faster while any is out; a new `growth` refetches at once; a 404 (an older engine) ends it for the tab's life. */
export function useSessionChildren(hostId: string, sessionId: string | undefined, growth: unknown): readonly SessionChild[] {
  const owner = sessionId ? `${hostId}:${sessionId}` : undefined;
  const [held, setHeld] = useState<{ owner: string; children: SessionChild[] }>();
  const children = held && held.owner === owner ? held.children : NONE;
  const lastRead = useRef<{ key: string; at: number }>(undefined);
  const key = `${owner}:${String(growth)}`;
  const wake = usePoll(
    async (signal) => {
      if (!sessionId || !owner || unsupported.has(owner)) return;
      const quiet = !children.some(childPending);
      if (quiet && lastRead.current?.key === key && Date.now() - lastRead.current.at < CHILDREN_IDLE_MS) return;
      lastRead.current = { key, at: Date.now() };
      const answer = await createEngineApi(hostFetcher(hostId))
        .children(sessionId)
        .catch((cause: unknown) => {
          if (cause instanceof EngineApiError && cause.status === 404) unsupported.add(owner);
          return undefined;
        });
      if (signal.aborted) return;
      if (Array.isArray(answer?.children)) setHeld({ owner, children: answer.children });
      else if (unsupported.has(owner)) setHeld({ owner, children: [] });
      return answer?.children.some(childPending);
    },
    owner && !unsupported.has(owner) ? CHILDREN_LIVE_MS : null,
    { key, backoff: true },
  );
  useSessionsStream(owner && hostId, (frame) => changesRow(frame) && children.some((child) => child.sessionId === frame.sessionId) && wake(), () => {});
  return children;
}

export function childrenGrowth(turns: readonly JournalTurn[]): string {
  const calls = (turns.at(-1)?.items ?? []).filter(
    (item) => item.detail.type === "mcp_tool_call" && item.status !== "inProgress" && displayToolName(item.detail.call.name).startsWith("sessions_"),
  ).length;
  return `${turns.length}:${calls}`;
}
