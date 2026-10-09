"use client";

import { useMemo, useState } from "react";
import type { Turn } from "@telar/engine-client";
import { createJournalProjector, hostPassiveArrivals, isActiveTurn, isCompacting, taskRoster } from "@telar/client/journal";
import { questionFields } from "@/features/composer";
import { actionableRequests } from "../failed-turn-recovery";
import { stillWorking } from "../background-presence";
import { withPendingTurn, type PendingTurn } from "../pending-turn";
import type { useSessionSync } from "./use-session-sync";

export function personQueue(turns: readonly Turn[]): { runId: string; text: string }[] {
  if (!turns.some((turn) => turn.state === "claimed" || turn.state === "running")) return [];
  return turns
    .filter((turn) => turn.state === "queued" && turn.origin === undefined && turn.kind !== "compact" && !turn.held)
    .sort((a, b) => a.sequence - b.sequence)
    .map((turn) => ({ runId: turn.runId, text: turn.input }));
}

/** The folded transcript and what the cockpit reads off it: the live turn and open requests. */
export function useTranscriptModel(sessionId: string | undefined, sync: ReturnType<typeof useSessionSync>, pending?: PendingTurn) {
  const { turns, items, events, tasks, requests } = sync;
  const [projectTranscript] = useState(createJournalProjector);
  // A peer's passive report is drawn inside the turn it arrived during.
  const transcript = useMemo(
    () => withPendingTurn(sessionId ? hostPassiveArrivals(projectTranscript(turns, items, events, tasks)) : [], pending),
    [sessionId, turns, items, events, tasks, projectTranscript, pending],
  );
  const roster = useMemo(() => taskRoster(tasks, transcript.flatMap((turn) => turn.tasks)), [tasks, transcript]);
  const active =
    transcript.find((turn) => turn.state === "claimed" || turn.state === "running") ?? transcript.find((turn) => isActiveTurn(turn.state) && !turn.held);
  const compacting = isCompacting(active);
  const openRequests = useMemo(() => actionableRequests(requests, transcript), [requests, transcript]);
  const composerQuestion = useMemo(() => openRequests.find((request) => questionFields(request).length > 0), [openRequests]);
  const newestUsage = [...transcript].reverse().find((turn) => turn.usage)?.usage;
  // Background work outlives its turn, so it is counted over every task, with the rail's own predicate.
  const backgroundTasks = stillWorking(tasks).length;
  const queued = useMemo(() => personQueue(turns), [turns]);
  return { transcript, roster, active, compacting, openRequests, composerQuestion, newestUsage, backgroundTasks, queued };
}
