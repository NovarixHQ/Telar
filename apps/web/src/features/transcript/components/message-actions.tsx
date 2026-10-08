"use client";

import { CopyButton } from "@/ui/code-surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/ui/utils";
import { rowTime } from "../row-time";

/** Time and Copy under a message, shown while its `group/message` is hovered or holds focus. */
export function MessageActions({ text, at, align = "start" }: { text: string; at?: number | undefined; align?: "start" | "end" }) {
  const time = at === undefined ? undefined : { ...rowTime(at), iso: new Date(at).toISOString() };
  return (
    <div
      data-slot="message-actions"
      className={cn(
        "flex h-5 items-center gap-1 text-2xs text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100",
        align === "end" && "justify-end",
      )}
    >
      {time && (
        <Tooltip>
          <TooltipTrigger render={<time dateTime={time.iso} className="tabular-nums" />}>{time.label}</TooltipTrigger>
          <TooltipContent>{time.full}</TooltipContent>
        </Tooltip>
      )}
      {text.trim() && <CopyButton text={text} className="size-5" />}
    </div>
  );
}
