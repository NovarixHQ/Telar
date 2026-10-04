"use client";

import { createContext, useContext } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { sessionKey, type SidebarSession } from "../session-list";
import { moveCandidates, parentKeyOf } from "./flat-rail";

export const RailRows = createContext<readonly SidebarSession[] | undefined>(undefined);

export function useRailParentTitle(session: SidebarSession): string | undefined {
  const rows = useContext(RailRows);
  const key = parentKeyOf(session);
  if (!rows || !key) return undefined;
  return rows.find((row) => sessionKey(row) === key)?.title || "its parent";
}

export function MoveSessionDialog({
  session,
  open,
  onOpenChange,
  onPick,
}: {
  session: SidebarSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (to: SidebarSession) => void;
}) {
  const rows = useContext(RailRows) ?? [];
  const candidates = open ? moveCandidates(session, rows) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{session.title || "Untitled session"}”</DialogTitle>
          <DialogDescription>Its results and questions go to the session you pick.</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other session can take it.</p>
        ) : (
          <ul className="-mx-2 max-h-80 overflow-y-auto" aria-label="Sessions">
            {candidates.map((candidate) => (
              <li key={sessionKey(candidate)}>
                <button
                  type="button"
                  onClick={() => onPick(candidate)}
                  className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span className="min-w-0 truncate">{candidate.title || "Untitled session"}</span>
                  {candidate.projectName ? <span className="shrink-0 text-xs text-muted-foreground">{candidate.projectName}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
