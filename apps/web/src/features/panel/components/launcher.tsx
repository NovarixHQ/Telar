"use client";

import { useEffect, useRef } from "react";
import { isEditableTarget } from "@/features/commands";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/ui/utils";
import type { BrowserStartState } from "../folds";
import { launcherRowForKey, type LauncherRow, type PanelTab } from "../model";
import type { PanelTabParams } from "../tabs";

export type LauncherActions = {
  onOpenTab: (tab: PanelTab) => void;
  onOpenNewTab?: (tab: PanelTab, params?: PanelTabParams) => void;
  onOpenBrowser?: () => void;
};

export function openLauncherRow(row: LauncherRow, actions: LauncherActions) {
  if (row.unavailable) return;
  if (row.id === "browser") actions.onOpenBrowser?.();
  else if (row.another && actions.onOpenNewTab) actions.onOpenNewTab(row.id);
  else actions.onOpenTab(row.id);
}

export function launcherLabel(row: LauncherRow, browserStart: BrowserStartState, canOpenNew: boolean): string {
  if (row.id === "browser" && browserStart.status === "pending") return "Starting the browser…";
  return row.another && canOpenNew ? `New ${row.label}` : row.label;
}

export function LauncherRowContent({ row, label, pending }: { row: LauncherRow; label: string; pending: boolean }) {
  return (
    <>
      {pending ? <Spinner className="size-3.5 shrink-0" /> : <row.icon className="size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {row.key && <kbd className="ml-auto rounded border border-border px-1 font-mono text-3xs uppercase text-muted-foreground">{row.key}</kbd>}
    </>
  );
}

/** While mounted, a bare letter outside a text field opens its row. */
function useLauncherKeys(rows: readonly LauncherRow[], actions: LauncherActions) {
  const latest = useRef({ rows, actions });
  useEffect(() => {
    latest.current = { rows, actions };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      const row = launcherRowForKey(latest.current.rows, event.key);
      if (!row) return;
      event.preventDefault();
      openLauncherRow(row, latest.current.actions);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function LauncherList({ rows, actions, browserStart, canOpenNew }: { rows: readonly LauncherRow[]; actions: LauncherActions; browserStart: BrowserStartState; canOpenNew: boolean }) {
  useLauncherKeys(rows, actions);
  return (
    <div role="group" aria-label="Surfaces" className="flex flex-col gap-0.5">
      {rows.map((row) => {
        const pending = row.id === "browser" && browserStart.status === "pending";
        return (
          <button
            key={row.id}
            type="button"
            aria-disabled={Boolean(row.unavailable) || pending}
            title={row.unavailable}
            onClick={() => (pending ? undefined : openLauncherRow(row, actions))}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted/60",
              row.unavailable && "cursor-default opacity-50 hover:bg-transparent",
            )}
          >
            <LauncherRowContent row={row} label={launcherLabel(row, browserStart, canOpenNew)} pending={pending} />
          </button>
        );
      })}
    </div>
  );
}
