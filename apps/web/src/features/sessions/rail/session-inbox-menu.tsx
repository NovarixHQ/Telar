"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon } from "lucide-react";
import { cn } from "@/ui/utils";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import { projectSettingsHref } from "@/features/projects";
import { canvasHref, sessionKey, type SidebarSession } from "../session-list";
import {
  closeRowTerminals,
  deleteSession,
  handOffRow,
  mutateRow,
  patchSession,
  regenerateTitle,
  withSettling,
  withSnooze,
  type SessionRowChange,
  type SessionRowChanged,
} from "../session-mutations";
import { sessionLink } from "../session-link";
import { desktopApp } from "@/platform/desktop/desktop-app";
import { type SettlingActivity } from "../session-settling";
import {
  buildSessionActionMenuItems,
  type SessionActionHandlers,
  type SessionActionItem,
  type SessionActionTarget,
} from "../session-action-menu";

import { Button } from "@/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import { dropdownSessionMenuParts, SessionActionContextMenu, SessionActionMenuItems } from "../components/session-action-menu";
import { MoveSessionDialog, useRailParentTitle } from "./move-session-dialog";

function menuTarget(session: SidebarSession, settled?: boolean, parentTitle?: string): SessionActionTarget {
  return {
    id: session.id,
    title: session.title,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    ...(session.projectName ? { projectName: session.projectName } : {}),
    ...(session.hostId ? { hostId: session.hostId } : {}),
    ...(session.workspacePath ? { workspacePath: session.workspacePath } : {}),
    ...(session.worktreeBranch ? { branch: session.worktreeBranch } : {}),
    ...(session.settledOverride ? { settledOverride: session.settledOverride } : {}),
    ...(settled === undefined ? {} : { settled }),
    ...(session.snoozedUntil === undefined ? {} : { snoozedUntil: session.snoozedUntil }),
    ...(session.snoozedAt === undefined ? {} : { snoozedAt: session.snoozedAt }),
    ...(session.terminals ? { terminals: session.terminals } : {}),
    ...(parentTitle === undefined ? {} : { parentTitle }),
    archived: session.archived,
    updatedAt: session.updatedAt,
  };
}

export type SessionRowMenuProps = {
  session: SidebarSession;
  activity?: SettlingActivity;
  now: number;
  settled?: boolean;
  active?: boolean;
  onRename?: () => void;
  onRowChanged?: SessionRowChanged;
  onLeave?: () => void;
};

function useSessionRowMenu({ session, activity = {}, now, settled, active, onRename, onRowChanged, onLeave }: SessionRowMenuProps): {
  items: SessionActionItem[];
  busy: boolean;
  picker: React.ReactNode;
} {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const parentTitle = useRailParentTitle(session);
  const handOff = (to?: string) => void handOffRow({ row: session, ...(to ? { to } : {}), onRowChanged: onRowChanged ?? (() => {}) });

  const mutate = async (after: SessionRowChange, send: Parameters<typeof mutateRow>[0]["send"]) => {
    if (busy) return;
    setBusy(true);
    try {
      await mutateRow({ before: session, after, send, onRowChanged: onRowChanged ?? (() => {}) });
    } finally {
      setBusy(false);
    }
  };

  const shell = desktopApp();

  const actions: SessionActionHandlers = {
    open: (href) => router.push(href),
    copyLink: (href) => void copyToClipboard(sessionLink(href)),
    ...(shell?.openWindow ? { openWindow: (href: string) => void shell.openWindow!(href) } : {}),
    newSession: ({ projectId, hostId, baseRef }) => router.push(canvasHref(projectId, hostId, baseRef ? { baseRef } : undefined)),
    pin: (pinned) =>
      void mutate({ row: withSettling(session, pinned ? "active" : null) }, () =>
        patchSession(session, { settledOverride: pinned ? "active" : null }),
      ),
    settle: (next) =>
      void mutate({ row: withSettling(session, next ? "settled" : null) }, async () => {
        if (next) return patchSession(session, { settledOverride: "settled" });
        if (session.settledOverride !== "settled") await patchSession(session, { settledOverride: "active" });
        return patchSession(session, { settledOverride: null });
      }),
    closeTerminals: () => void closeRowTerminals({ row: session, onRowChanged: onRowChanged ?? (() => {}) }),
    snooze: (until) => void mutate({ row: withSnooze(session, until) }, () => patchSession(session, { snoozedUntil: until })),
    rename: () => onRename?.(),
    regenerateTitle: () => void mutate({ row: session }, () => regenerateTitle(session)),
    copy: (text) => void copyToClipboard(text),
    projectSettings: ({ projectId }) => router.push(projectSettingsHref(projectId)),
    moveTo: () => setMoving(true),
    detach: () => handOff(),
    remove: () => {
      const name = session.title || "Untitled session";
      if (!window.confirm(`Delete "${name}"?`)) return;
      if (!window.confirm(`This removes the transcript and the worktree for "${name}". It cannot be undone.`)) return;
      void mutate({ removed: sessionKey(session) }, () => deleteSession(session)).then(() => {
        if (active) onLeave?.();
      });
    },
  };

  const items = buildSessionActionMenuItems({
    session: menuTarget(session, settled, parentTitle),
    activity,
    now,
    capabilities: {
      remote: Boolean(session.hostId && session.hostId !== LOCAL_HOST_ID),
      current: Boolean(active),
    },
    actions,
  });
  const picker = parentTitle === undefined ? null : (
    <MoveSessionDialog
      session={session}
      open={moving}
      onOpenChange={setMoving}
      onPick={(to) => {
        setMoving(false);
        handOff(to.id);
      }}
    />
  );
  return { items, busy, picker };
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.alert("The browser refused to copy that.");
  }
}

export function SessionRowContextMenu({ children, ...props }: SessionRowMenuProps & { children: React.ReactNode }) {
  const { items, picker } = useSessionRowMenu(props);
  return (
    <>
      <SessionActionContextMenu items={items}>{children}</SessionActionContextMenu>
      {picker}
    </>
  );
}

export function SessionInboxMenu({ className, ...props }: SessionRowMenuProps & { className?: string }) {
  const { items, busy, picker } = useSessionRowMenu(props);
  const [open, setOpen] = useState(false);

  return (
    <>
      {picker}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Session actions"
              title="Session actions"
              disabled={busy}
              className={cn("text-muted-foreground hover:text-foreground", className)}
            />
          }
        >
          {busy ? <Spinner className="size-3" /> : <MoreHorizontalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <SessionActionMenuItems items={items} parts={dropdownSessionMenuParts} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
