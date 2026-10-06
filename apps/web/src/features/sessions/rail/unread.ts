import { useEffect } from "react";
import { desktopApp } from "@/platform/desktop/desktop-app";
import { sessionKey, type SessionBand, type SidebarSession } from "../session-list";
import { hasUnreadResult } from "../session-settling";
import { parentKeyOf } from "./flat-rail";

export function showsUnreadMark(session: SidebarSession, open: boolean): boolean {
  if (open || parentKeyOf(session) !== undefined) return false;
  if (session.activity === "blocked" || session.activity === "working" || session.activity === "queued") return false;
  return hasUnreadResult(session);
}

export function railUnread(
  sessions: readonly SidebarSession[],
  openKey: string | undefined,
  bandFor: (session: SidebarSession) => SessionBand,
): { count: number; openUnread: boolean } {
  let count = 0;
  let openUnread = false;
  for (const session of sessions) {
    const band = bandFor(session);
    if (band !== "active" && band !== "pinned") continue;
    if (!showsUnreadMark(session, false)) continue;
    if (sessionKey(session) === openKey) openUnread = true;
    else count += 1;
  }
  return { count, openUnread };
}

export function useDockUnread(sessions: readonly SidebarSession[], openKey: string | undefined, bandFor: (session: SidebarSession) => SessionBand): void {
  const { count, openUnread } = railUnread(sessions, openKey, bandFor);
  useEffect(() => {
    desktopApp()?.setUnread?.(count, openUnread).catch(() => undefined);
  }, [count, openUnread]);
}
