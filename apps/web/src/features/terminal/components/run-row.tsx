"use client";

import { PlusIcon } from "lucide-react";
import { ActionRow, SplitRow, SplitRowChevron, SplitRowMain } from "@/ui/action-row";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { cn } from "@/ui/utils";
import { RunGlyph } from "../run/icons";
import type { RunApi } from "../run/api";
import type { RunView } from "../run/types";
import { headerMode, useRunHeader } from "../hooks/use-run-header";
import { RunHeaderEditor, RunHeaderMenu } from "./run-header-menu";

/** The Workspace card's Run row: one press runs the first configuration, the chevron lists and edits the rest. */
export function RunRow({
  sessionId,
  hostId,
  api,
  onWatchOutput,
  onTerminals,
}: {
  sessionId: string;
  hostId?: string;
  api?: RunApi;
  onWatchOutput?: () => void;
  onTerminals?: (terminals: readonly RunView[]) => void;
}) {
  const header = useRunHeader({ sessionId, hostId, api, onTerminals });
  const { configs, editing } = header;
  const setup = headerMode(configs) === "setup";
  const first = configs?.[0];

  return (
    <Popover
      open={header.open}
      onOpenChange={(next: boolean) => {
        header.setOpen(next);
        if (next && setup) header.setEditing({});
        if (!next) header.setEditing(undefined);
      }}
    >
      {setup ? (
        <PopoverTrigger
          render={
            <ActionRow aria-label="Add a run configuration">
              <PlusIcon />
              <span className="min-w-0 flex-1 truncate">Add run configuration</span>
            </ActionRow>
          }
        />
      ) : (
        <SplitRow menu={<PopoverTrigger render={<SplitRowChevron aria-label="Choose what to run" />} />}>
          <SplitRowMain
            disabled={header.busy}
            aria-label={first ? `Run ${first.name}` : "Run this project"}
            title="Types this command into its idle terminal, or opens a new one"
            onClick={first ? () => header.start(first.id) : () => header.setOpen(true)}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-success/15 text-success">
              <RunGlyph {...(first?.icon ? { icon: first.icon } : {})} className="size-3!" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Run{first && <span className="font-normal text-muted-foreground"> {first.name}</span>}
            </span>
          </SplitRowMain>
        </SplitRow>
      )}
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className={cn("flex-col gap-0 overflow-hidden rounded-xl p-0", editing ? "max-h-[min(40rem,calc(100vh-7rem))] w-[26rem]" : "w-80")}
      >
        {editing ? <RunHeaderEditor header={header} /> : <RunHeaderMenu header={header} onWatchOutput={onWatchOutput} />}
      </PopoverContent>
    </Popover>
  );
}
