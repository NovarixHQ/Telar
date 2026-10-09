"use client";

import type { KeyboardEvent, RefObject } from "react";
import { cn } from "@/ui/utils";
import { statusDot } from "./destination-picker";
import type { NeedsYou } from "./needs-you";

const LABEL: Record<NeedsYou["kind"], string> = { waiting: "Waiting on you", unread: "Unread", running: "Working" };

export function NeedsYouStrip({ items, strip, onPick, onLeave }: {
  items: readonly NeedsYou[];
  strip: RefObject<HTMLDivElement | null>;
  onPick: (item: NeedsYou) => void;
  onLeave: () => void;
}) {
  if (items.length === 0) return null;
  const pills = () => [...(strip.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const all = pills();
    const at = all.indexOf(event.currentTarget);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") all[(at + (event.key === "ArrowRight" ? 1 : -1) + all.length) % all.length]?.focus();
    else if (event.key === "ArrowDown" || event.key === "Escape") onLeave();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div ref={strip} role="toolbar" aria-label="Conversations that need you" className="mx-6 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
      {items.map((item) => (
        <button
          key={item.session.id}
          type="button"
          onClick={() => onPick(item)}
          onKeyDown={onKeyDown}
          title={`${item.session.title} · ${item.projectName}`}
          className="flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-full border border-border bg-popover px-2.5 text-xs text-popover-foreground shadow-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("size-2 shrink-0 rounded-full", item.kind === "unread" ? "bg-primary" : statusDot(item.session))} />
          <span className="truncate">{item.session.title}</span>
          <span className="sr-only">{LABEL[item.kind]}</span>
        </button>
      ))}
    </div>
  );
}
