"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type JournalItem, type JournalTask } from "@telar/client/journal";
import { cutAroundStandingRows, failedCount, renderable } from "../model";
import { TranscriptRows } from "./activity";
import { AgentCluster, useAgentLive } from "./agent-cluster";
import { RowGestures } from "./tool-row";
import { TranscriptItem } from "./transcript-item";

export function formatWorkDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1_000) return "<1s";
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`;
  const total = Math.round(ms / 1_000);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function workedForLabel(startedAt: number | undefined, endedAt: number | undefined): string {
  if (startedAt === undefined || endedAt === undefined || endedAt < startedAt) return "Worked";
  return `Worked for ${formatWorkDuration(endedAt - startedAt)}`;
}

export function TurnWork({
  items,
  tasks,
  label,
  detail,
  ...gestures
}: { items: readonly JournalItem[]; tasks: JournalTask[]; label: string; detail?: string } & RowGestures) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => renderable([...items], tasks), [items, tasks]);
  const agentLive = useAgentLive(tasks);
  if (rows.length === 0) return null;
  const standing = cutAroundStandingRows(rows, agentLive).flatMap((cut) => (cut.kind === "run" ? [] : [cut]));
  const failures = failedCount(rows, tasks);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        {...(detail ? { title: detail } : {})}
        className="flex w-fit cursor-pointer select-none items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{label}</span>
        {failures > 0 && !open && <span className="text-destructive">· {failures} failed</span>}
        <Chevron className="size-3.5 shrink-0" />
      </button>
      {open ? (
        <TranscriptRows rows={rows} tasks={tasks} {...gestures} />
      ) : (
        standing.map((cut) =>
          cut.kind === "agents" ? (
            <AgentCluster key={cut.items[0]!.id} items={cut.items} tasks={tasks} {...gestures} />
          ) : (
            <TranscriptItem key={cut.item.id} item={cut.item} tasks={tasks} {...gestures} />
          ),
        )
      )}
    </div>
  );
}
