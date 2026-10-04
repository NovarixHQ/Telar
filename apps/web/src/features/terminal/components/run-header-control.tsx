"use client";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { cn } from "@/ui/utils";
import { RunGlyph } from "../run/icons";
import type { RunApi } from "../run/api";
import type { RunView } from "../run/types";
import { headerMode, useRunHeader } from "../hooks/use-run-header";
import { RunHeaderEditor, RunHeaderMenu } from "./run-header-menu";

/** The masthead's run pill: an action menu. Busy and idle show on the panel's terminal strip, not here. */
export function RunHeaderControl({
  sessionId,
  hostId,
  api,
  onWatchOutput,
  onTerminals,
}: {
  sessionId: string;
  /** Which Mac this session lives on. Absent means the local one. */
  hostId?: string;
  /** Injected by tests and the fixture; production builds a pinned client. */
  api?: RunApi;
  /** Opens the right panel's Terminal tab. */
  onWatchOutput?: () => void;
  /** Every status answer, shared with whoever reveals new terminals so the feed is not read twice. */
  onTerminals?: (terminals: readonly RunView[]) => void;
}) {
  const header = useRunHeader({ sessionId, hostId, api, onTerminals });
  const { configs, editing } = header;
  const setup = headerMode(configs) === "setup";
  const label = setup ? "Run — set up a configuration" : "Run this project";

  return (
    <Popover
      open={header.open}
      onOpenChange={(next: boolean) => {
        header.setOpen(next);
        // Straight into the editor when there is nothing to pick; cancelling then shows the empty menu.
        if (next && setup) header.setEditing({});
        if (!next) header.setEditing(undefined);
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" aria-label={label} className="h-7 gap-1.5 px-2 text-xs font-medium">
            {setup ? (
              <>
                <PlusIcon className="size-3.5 shrink-0" />
                <span className="max-w-32 truncate">Run</span>
              </>
            ) : (
              <>
                <RunGlyph className="size-3.5 shrink-0 opacity-80" />
                <span>Run</span>
                <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
              </>
            )}
          </Button>
        }
      />
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Clamped to the viewport so the form's Save button is never below the fold.
        className={cn("flex-col gap-0 overflow-hidden rounded-xl p-0", editing ? "max-h-[min(40rem,calc(100vh-7rem))] w-[26rem]" : "w-80")}
      >
        {editing ? <RunHeaderEditor header={header} /> : <RunHeaderMenu header={header} onWatchOutput={onWatchOutput} />}
      </PopoverContent>
    </Popover>
  );
}
