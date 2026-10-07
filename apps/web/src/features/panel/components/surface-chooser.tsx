"use client";

import { useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { cn } from "@/ui/utils";
import type { BrowserStartState } from "../folds";
import { launcherRowForKey, type LauncherRow } from "../model";
import { launcherLabel, LauncherRowContent, openLauncherRow, type LauncherActions } from "./launcher";

/** The "+" menu. A kind already in the strip is here only because a second one is a different thing, so it opens another. */
export function SurfaceChooser({ rows, actions, browserStart }: { rows: readonly LauncherRow[]; actions: LauncherActions; browserStart: BrowserStartState }) {
  const [open, setOpen] = useState(false);
  /**
   * The primitive defers its toggle to a rAF, which an occluded renderer (the native browser view) may never run.
   * So the mouse press decides and the click applies; `undefined` leaves a keyboard activation to the primitive.
   */
  const press = useRef<boolean>(undefined);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        onMouseDown={() => {
          press.current = !open;
        }}
        onClick={() => {
          const wanted = press.current;
          press.current = undefined;
          if (wanted !== undefined) setOpen(wanted);
        }}
        render={
          <button type="button" aria-label="Open a surface" title="Open a surface"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground">
            <PlusIcon className="size-4" />
          </button>
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-48"
        onKeyDownCapture={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          const row = launcherRowForKey(rows, event.key);
          if (!row) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          openLauncherRow(row, actions);
        }}
      >
        {rows.map((row) => {
          const pending = row.id === "browser" && browserStart.status === "pending";
          return (
            <DropdownMenuItem
              key={row.id}
              disabled={pending}
              closeOnClick={!row.unavailable}
              title={row.unavailable}
              aria-disabled={row.unavailable ? true : undefined}
              className={cn(row.unavailable && "opacity-50")}
              onClick={() => openLauncherRow(row, actions)}
            >
              <LauncherRowContent row={row} label={launcherLabel(row, browserStart, actions.onOpenNewTab !== undefined)} pending={pending} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
