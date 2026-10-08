"use client";

import { useMemo, useState } from "react";
import { Maximize2Icon, Minimize2Icon, PanelRightCloseIcon, XIcon } from "lucide-react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/ui/context-menu";
import { KeyHint } from "@/features/commands";
import { cn } from "@/ui/utils";
import { useLivePages } from "../hooks/use-live-pages";
import { useTabDrag } from "../hooks/use-tab-drag";
import { describePanelTabInstance, filePanelTabPath, type BrowserState, type LauncherRow, type LivePage, type PanelTabItem } from "../model";
import type { RightPanelProps } from "./right-panel";
import type { LauncherActions } from "./launcher";
import { SurfaceChooser } from "./surface-chooser";

type StripProps = Pick<RightPanelProps, "tabs" | "tab" | "sessionId" | "onTabChange" | "onCloseTab" | "onMoveTab" | "browserStart" | "onClose"> & {
  browser: BrowserState | undefined;
  launcher: readonly LauncherRow[];
  actions: LauncherActions;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

const CONTROL = "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/**
 * One tab. The chip is the drag handle; its context menu's trigger is a child row so a grab and a right-press never
 * land on one node. The insert mark is an inset shadow so drag-over never widens the tab.
 */
function TabChip({
  entry,
  strip,
  live,
  duplicate,
  drag,
  menu,
}: {
  entry: PanelTabItem;
  strip: StripProps;
  live: readonly LivePage[] | undefined;
  duplicate: boolean;
  drag: ReturnType<typeof useTabDrag>;
  menu: [string | undefined, (id: string | undefined) => void];
}) {
  const { id } = entry;
  const { tabs, onCloseTab, fullscreen, onToggleFullscreen } = strip;
  const on = id === strip.tab;
  const { label, icon: Icon, missing } = describePanelTabInstance(entry, { ...(strip.browser ? { browser: strip.browser } : {}), ...(live ? { live } : {}), duplicate });
  const insert = drag.insert?.id === id ? drag.insert.side : undefined;
  const right = tabs.slice(tabs.findIndex((other) => other.id === id) + 1);
  const path = entry.params.path ?? filePanelTabPath(entry.kind);
  return (
    <span
      {...drag.handlers(id)}
      className={cn(
        "group/tab relative flex h-7 min-w-0 max-w-44 shrink-0 cursor-grab rounded-md text-xs transition-colors active:cursor-grabbing",
        on ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        missing && "opacity-60",
        drag.dragging === id && "opacity-40",
        insert === "before" && "shadow-[inset_2px_0_0_0_var(--color-primary)]",
        insert === "after" && "shadow-[inset_-2px_0_0_0_var(--color-primary)]",
      )}
    >
      <ContextMenu open={menu[0] === id} onOpenChange={(next: boolean) => menu[1](next ? id : undefined)}>
        <ContextMenuTrigger render={<span className="flex min-w-0 flex-1 items-center px-1.5" />}>
          <button
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`right-panel-${id}`}
            onClick={() => strip.onTabChange(id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onCloseTab(id);
              }
            }}
            title={label}
            className="flex min-w-0 flex-1 items-center gap-1.5 outline-none"
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={() => onCloseTab(id)}
            className={cn(
              "ml-1 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100",
              on ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70 pointer-coarse:opacity-70",
            )}
          >
            <XIcon className="size-3" />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {path && (
            <>
              <ContextMenuItem onClick={() => void navigator.clipboard.writeText(path)}>Copy path</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => onCloseTab(id)}>Close</ContextMenuItem>
          <ContextMenuItem disabled={tabs.length <= 1} onClick={() => tabs.filter((other) => other.id !== id).forEach((other) => onCloseTab(other.id))}>
            Close others
          </ContextMenuItem>
          <ContextMenuItem disabled={right.length === 0} onClick={() => right.forEach((other) => onCloseTab(other.id))}>
            Close to the right
          </ContextMenuItem>
          <ContextMenuItem onClick={() => tabs.forEach((other) => onCloseTab(other.id))}>Close all</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onToggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fill the window"}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </span>
  );
}

/** The panel's top bar. It closes the panel only in fullscreen, where it is the window's titlebar. */
export function TabStrip(strip: StripProps) {
  const { tabs, sessionId, fullscreen, launcher, browserStart = { status: "idle" } } = strip;
  const menu = useState<string>();
  const drag = useTabDrag(tabs, strip.onMoveTab);
  const livePages = useLivePages(sessionId);
  const duplicated = useMemo(() => {
    const counted = new Map<string, number>();
    for (const entry of tabs) counted.set(entry.kind, (counted.get(entry.kind) ?? 0) + 1);
    return new Set([...counted].filter(([, count]) => count > 1).map(([kind]) => kind));
  }, [tabs]);

  return (
    <div
      className={cn(
        "@container/strip flex h-10 shrink-0 items-center gap-1 px-2 py-0",
        fullscreen && "pl-[max(8px,calc(var(--titlebar-inset)+var(--app-island-inset)))] md:h-[var(--titlebar-band-height)]",
      )}
    >
      <div role="tablist" aria-label="Right panel tabs" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((entry) => (
          <TabChip
            key={entry.id}
            entry={entry}
            strip={strip}
            live={livePages}
            duplicate={duplicated.has(entry.kind)}
            drag={drag}
            menu={menu}
          />
        ))}
        {launcher.length > 0 && <SurfaceChooser rows={launcher} actions={strip.actions} browserStart={browserStart} />}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {tabs.length > 1 && (
          <span className="mr-1 hidden items-center gap-0.5 @2xl/strip:flex">
            <KeyHint command="panel-previous-tab" />
            <KeyHint command="panel-next-tab" />
          </span>
        )}
        <button
          type="button"
          aria-label={fullscreen ? "Exit fullscreen" : "Fill the window"}
          title={fullscreen ? "Exit fullscreen" : "Fill the window"}
          onClick={strip.onToggleFullscreen}
          className={CONTROL}
        >
          {fullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
        </button>
        {fullscreen && (
          <>
            <button type="button" aria-label="Close right panel" title="Close right panel" onClick={strip.onClose} className={CONTROL}>
              <PanelRightCloseIcon className="size-4" />
            </button>
            <span className="hidden @lg/strip:contents">
              <KeyHint command="toggle-panel" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
