"use client";

import { Fragment, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { workspaceOpenBlocker, workspaceOpener, type WorkspaceOpenersAnswer } from "../workspace-open";
import {
  preferredOpenerSnapshot,
  remembersOpener,
  serverPreferredOpenerSnapshot,
  subscribePreferredOpener,
  workspaceOpenerEntries,
  workspaceOpenerPrimary,
  workspaceOpenerPrimaryLabel,
  writePreferredOpener,
  type WorkspaceOpenerEntry,
} from "../workspace-opener-preference";
import { useCommandHandlers, KeyHint } from "@/features/commands";
import { OpenerIcon } from "./opener-icon";
import { ActionRow, SplitRow, SplitRowChevron, SplitRowMain } from "@/ui/action-row";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

/** The Workspace card's Open row: one press opens in the remembered app, the chevron lists the rest. */
export function OpenWorkspaceRow({
  path,
  hostId,
  hostLabel,
}: {
  path: string | undefined;
  hostId?: string | undefined;
  hostLabel?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<WorkspaceOpenersAnswer>();
  const [error, setError] = useState<string>();
  const preferred = useSyncExternalStore(
    subscribePreferredOpener,
    useCallback(() => preferredOpenerSnapshot(hostId), [hostId]),
    serverPreferredOpenerSnapshot,
  );
  const bridge = workspaceOpener();
  const blocker = workspaceOpenBlocker({ path, hostId, hostLabel, hasBridge: Boolean(bridge) });

  const refresh = useCallback(() => {
    if (blocker || !bridge?.openers) return undefined;
    let live = true;
    void bridge
      .openers()
      .then((found) => live && setAnswer(found))
      .catch(() => live && setAnswer({ openers: [] }));
    return () => {
      live = false;
    };
  }, [blocker, bridge]);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => (open ? refresh() : undefined), [open, refresh]);

  const entries = workspaceOpenerEntries({ openers: answer?.openers ?? [], preferred, revealIconDataUrl: answer?.revealIconDataUrl });
  const primary = answer === undefined ? undefined : workspaceOpenerPrimary(entries);
  const primaryLabel = primary ? workspaceOpenerPrimaryLabel(entries) : "Open";

  const act = (entry: WorkspaceOpenerEntry) => {
    setError(undefined);
    if (remembersOpener(entry)) writePreferredOpener(hostId, entry.id);
    void (entry.kind === "reveal" ? bridge!.reveal(path!) : bridge!.open(path!, entry.openerId))
      .then((result) => {
        if (!result.ok) setError(result.error ?? "That folder could not be opened.");
        else setOpen(false);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "That folder could not be opened."));
  };

  const canReveal = !blocker && Boolean(bridge) && Boolean(path);
  useCommandHandlers(
    canReveal
      ? {
          "open-in-app": () => (primary ? act(primary) : setOpen(true)),
          "reveal-in-finder": () => {
            setError(undefined);
            void bridge!
              .reveal(path!)
              .then((result) => {
                if (result.ok) return;
                setError(result.error ?? "That folder could not be shown.");
                setOpen(true);
              })
              .catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "That folder could not be shown.");
                setOpen(true);
              });
          },
        }
      : {},
    [canReveal, primary],
  );

  if (!bridge && typeof window !== "undefined" && !(window as { telarDesktop?: unknown }).telarDesktop) return null;

  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {blocker ? (
        <PopoverTrigger
          render={
            <ActionRow aria-label="Open workspace" title={blocker}>
              <ExternalLinkIcon />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">Open</span>
            </ActionRow>
          }
        />
      ) : (
        <SplitRow
          menu={<PopoverTrigger render={<SplitRowChevron aria-label="Choose an app to open this folder with" />} />}
        >
          <SplitRowMain
            onClick={primary ? () => act(primary) : () => setOpen(true)}
            title={primary ? `${primaryLabel} — ${path}` : "Open this session's folder"}
            aria-label={primary ? primaryLabel : "Open this session's folder"}
          >
            <OpenerIcon icon={primary?.icon} iconDataUrl={primary?.iconDataUrl} />
            <span className="min-w-0 flex-1 truncate">{primaryLabel}</span>
            {primary && <KeyHint command="open-in-app" />}
          </SplitRowMain>
        </SplitRow>
      )}
      <PopoverContent align="end" side="bottom" sideOffset={6} className="max-h-[min(24rem,70vh)] w-72 flex-col gap-0 overflow-y-auto rounded-xl p-1">
        {blocker ? (
          <p className="px-2 py-1.5 text-2xs leading-snug text-muted-foreground">{blocker}</p>
        ) : answer === undefined ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">Looking for installed apps…</p>
        ) : (
          <>
            {entries.map((entry) => (
              <Fragment key={entry.id}>
                {entry.separatorBefore && <div className="my-1 h-px bg-border" />}
                {entry.kind === "empty" ? (
                  <p className="px-2 py-1.5 text-2xs leading-snug text-muted-foreground">{entry.label}</p>
                ) : (
                  <button type="button" title={entry.path} onClick={() => act(entry)} className={row}>
                    <OpenerIcon icon={entry.icon} iconDataUrl={entry.iconDataUrl} />
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {entry === primary && entry.kind !== "reveal" && <KeyHint command="open-in-app" />}
                    {entry.kind === "reveal" && canReveal && <KeyHint command="reveal-in-finder" />}
                  </button>
                )}
              </Fragment>
            ))}
            <p className="px-2 py-1 font-mono text-3xs leading-snug break-all text-muted-foreground/80">{path}</p>
          </>
        )}
        {error && <p className="px-2 py-1.5 text-2xs leading-snug text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
