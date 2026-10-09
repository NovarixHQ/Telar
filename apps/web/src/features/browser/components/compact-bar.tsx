"use client";

import { useEffect } from "react";
import { ArrowLeftIcon, PanelRightIcon, PinOffIcon, RotateCwIcon, XIcon } from "lucide-react";
import { cn } from "@/ui/utils";
import { siteLabel } from "../desktop-site-permissions";
import type { BrowserUi } from "../hooks/use-browser-session";

const GLYPH = "app-no-drag shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";

export function CompactBar({ b }: { b: BrowserUi }) {
  const { activeTab, activeOrigin, act } = b;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) window.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="app-drag group flex h-7 shrink-0 items-center gap-0.5 px-1.5" aria-label="Picture in picture controls">
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground group-focus-within:hidden group-hover:hidden">
        {activeOrigin ? siteLabel(activeOrigin) : (activeTab?.title ?? "")}
      </span>
      <div className="hidden min-w-0 flex-1 items-center gap-0.5 group-focus-within:flex group-hover:flex">
        <button type="button" aria-label="Go back" title="Back" disabled={!activeTab?.canGoBack} className={GLYPH} onClick={() => void act({ action: "back" })}>
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <button type="button" aria-label="Reload" title="Reload" className={GLYPH} onClick={() => void act({ action: "reload" })}>
          <RotateCwIcon className={cn("size-3.5", activeTab?.loading && "animate-spin text-primary")} />
        </button>
        <span className="flex-1" />
        <button type="button" aria-label="Turn off on top" title="Turn off on top" className={GLYPH} onClick={() => void act({ action: "float", on: false })}>
          <PinOffIcon className="size-3.5" />
        </button>
      </div>
      <button type="button" aria-label="Return to the panel" title="Return to the panel" className={GLYPH} onClick={() => void act({ action: "bring-back", focus: true })}>
        <PanelRightIcon className="size-3.5" />
      </button>
      <button type="button" aria-label="Close picture in picture" title="Close (Esc)" className={GLYPH} onClick={() => window.close()}>
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
