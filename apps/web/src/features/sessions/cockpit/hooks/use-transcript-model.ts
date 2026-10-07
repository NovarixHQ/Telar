"use client";

import { useMemo, useState } from "react";
import { createJournalProjector, hostPassiveArrivals, isActiveTurn, isCompacting, taskRoster } from "@/platform/engine";
import { questionFields } from "@/features/composer";
import { actionableRequests } from "../failed-turn-recovery";
import { stillWorking } from "../background-presence";
import type { useSessionSync } from "./use-session-sync";

/** The folded transcript and what the cockpit reads off it: the live turn and open requests. */
export function useTranscriptModel(sessionId: string | undefined, sync: ReturnType<typeof useSessionSync>) {
  const { turns, items, events, tasks, requests } = sync;
  const [projectTranscript] = useState(createJournalProjector);
  // A peer's passive report is drawn inside the turn it arrived during.
  const transcript = useMemo(
    () => (sessionId ? hostPassiveArrivals(projectTranscript(turns, items, events, tasks)) : []),
    [sessionId, turns, items, events, tasks, projectTranscript],
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
  return { transcript, roster, active, compacting, openRequests, composerQuestion, newestUsage, backgroundTasks };
}
