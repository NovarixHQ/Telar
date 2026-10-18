"use client";

import type { FormEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import type { BrowserInput, BrowserTab } from "@telar/engine-client";
import { cn } from "@/ui/utils";

type Props = {
  tabs: BrowserTab[];
  address: string;
  onAddress: (value: string | undefined) => void;
  onSubmit: (event: FormEvent) => void;
  send: (input: BrowserInput) => void;
};

export function EngineBrowserChrome({ tabs, address, onAddress, onSubmit, send }: Props) {
  const tool = "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <>
    <div role="tablist" aria-label="Browser tabs" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
      {tabs.map((tab) => (
        <div key={tab.id} className={cn("flex max-w-40 shrink-0 items-center rounded-md text-2xs", tab.active ? "bg-muted text-foreground" : "text-muted-foreground")}>
          <button type="button" role="tab" aria-selected={tab.active} className="min-w-0 truncate px-2 py-1" onClick={() => send({ type: "tab", action: "select", tabId: tab.id })}>
            {tab.title || tab.url || "New tab"}
          </button>
          <button type="button" aria-label={`Close ${tab.title || tab.url || "tab"}`} className="grid size-5 shrink-0 place-items-center rounded hover:bg-background" onClick={() => send({ type: "tab", action: "close", tabId: tab.id })}>
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      <button type="button" aria-label="New tab" className={tool} onClick={() => send({ type: "tab", action: "new" })}>
        <PlusIcon className="size-3.5" />
      </button>
    </div>
    <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
      <button type="button" aria-label="Back" className={tool} onClick={() => send({ type: "history", action: "back" })}>
        <ArrowLeftIcon className="size-3.5" />
      </button>
      <button type="button" aria-label="Forward" className={tool} onClick={() => send({ type: "history", action: "forward" })}>
        <ArrowRightIcon className="size-3.5" />
      </button>
      <button type="button" aria-label="Reload" className={tool} onClick={() => send({ type: "history", action: "reload" })}>
        <RotateCwIcon className="size-3.5" />
      </button>
      <input
        aria-label="Address"
        value={address}
        onChange={(event) => onAddress(event.target.value)}
        onBlur={() => onAddress(undefined)}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </form>
    </>
  );
}
