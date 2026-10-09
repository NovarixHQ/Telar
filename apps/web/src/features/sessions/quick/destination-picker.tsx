"use client";

import { useState } from "react";
import type { LiveSessionRow } from "@telar/engine-client";
import { PlusIcon } from "lucide-react";
import { fmtAgo } from "@/ui/format";
import { cn } from "@/ui/utils";
import { rowStatusText } from "../session-activity";
import type { DestinationRow } from "./destination";

export function statusDot(session: Pick<LiveSessionRow, "activity">) {
  if (session.activity === "blocked") return "bg-warning";
  if (session.activity === "working") return "bg-info ring-3 ring-info/25";
  return "bg-success";
}

export function sessionStatus(session: LiveSessionRow, now: number) {
  const { badge, time } = rowStatusText(session, now);
  return badge?.label ?? `Idle · ${time}`;
}

function rowKey(row: DestinationRow) {
  return row.kind === "project" ? `project:${row.project.id}` : row.session.id;
}

export function DestinationPicker({ rows, index, onPick }: { rows: readonly DestinationRow[]; index: number; onPick: (row: DestinationRow, worktree: boolean) => void }) {
  const [now] = useState(Date.now);
  return (
    <div className="mx-6 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2">
      <div className="flex justify-between px-2 pt-1 pb-1.5 text-2xs text-muted-foreground">
        <span>Where does it go?</span>
        <span>↑↓ choose · ↵ attach</span>
      </div>
      <div role="listbox" aria-label="Destination">
        {rows.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Nothing matches</p>}
        {rows.map((row, at) => (
          <div
            key={rowKey(row)}
            role="option"
            aria-selected={at === index}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(row, event.altKey);
            }}
            className={cn("flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5", at === index && "bg-accent text-accent-foreground")}
          >
            {row.kind === "project" ? (
              <>
                <span className="grid size-5 shrink-0 place-items-center rounded-md border border-dashed border-border"><PlusIcon className="size-3" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">New session in {row.project.name ?? row.project.id}</span>
                  <span className="block truncate text-2xs text-muted-foreground">↵ checkout · ⌥↵ new worktree</span>
                </span>
              </>
            ) : (
              <>
                <span className={cn("size-2 shrink-0 rounded-full", statusDot(row.session))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.session.title}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{row.projectName} · {sessionStatus(row.session, now)}</span>
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">{fmtAgo(row.session.updatedAt, now)}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
