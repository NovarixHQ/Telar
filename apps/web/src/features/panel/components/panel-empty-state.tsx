"use client";

import type { BrowserStartState } from "../folds";
import type { LauncherRow } from "../model";
import { LauncherList, type LauncherActions } from "./launcher";

/** The panel before anything is open: the launcher, with a letter per surface. */
export function PanelEmptyState({ rows, actions, browserStart, canOpenNew }: { rows: readonly LauncherRow[]; actions: LauncherActions; browserStart: BrowserStartState; canOpenNew: boolean }) {
  return (
    <div className="flex h-full flex-col justify-center p-4">
      <div className="mx-auto w-full max-w-60">
        <h2 className="mb-2 px-2.5 text-xs text-muted-foreground">Open a surface</h2>
        <LauncherList rows={rows} actions={actions} browserStart={browserStart} canOpenNew={canOpenNew} />
        {browserStart.status === "error" && (
          <p role="alert" className="mt-1.5 px-2.5 text-2xs leading-relaxed text-destructive">
            {browserStart.message}
          </p>
        )}
      </div>
    </div>
  );
}
