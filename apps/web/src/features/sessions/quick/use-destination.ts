"use client";

import { useCallback, useMemo, useState } from "react";
import { LOCAL_HOST_ID } from "@/platform/engine/host-client";
import type { SidebarSession } from "../session-list";
import { destinationQuery, destinationRows, type Destination, type DestinationRow } from "./destination";
import { projectKey, type QuickProject } from "./hosts";

type Key = { key: string; altKey: boolean };

export function useDestination({ text, setText, sessions, projects, project, onProject }: {
  text: string;
  setText: (text: string) => void;
  sessions: readonly SidebarSession[];
  projects: readonly QuickProject[];
  project: QuickProject | undefined;
  onProject: (key: string) => void;
}) {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const query = destinationQuery(text);
  const picking = query !== null;

  const rows = useMemo(() => (query === null ? [] : destinationRows(query, projects, sessions, project)), [query, projects, sessions, project]);
  const index = selection.query === query ? Math.min(selection.index, Math.max(rows.length - 1, 0)) : 0;

  const pick = (row: DestinationRow, worktree: boolean) => {
    setText("");
    if (row.kind === "session") {
      setDestination(row);
      if (row.session.projectId) onProject(projectKey({ id: row.session.projectId, hostId: row.session.hostId ?? LOCAL_HOST_ID }));
    } else {
      onProject(projectKey(row.project));
      setDestination({ kind: "project", project: row.project, envMode: worktree ? "worktree" : "local" });
    }
  };

  const move = (step: number) => setSelection({ query: query ?? "", index: (index + step + rows.length) % Math.max(rows.length, 1) });

  const onKey = ({ key, altKey }: Key): boolean => {
    if (!picking) {
      if (key !== "Backspace" || text !== "" || !destination) return false;
      setDestination(null);
      return true;
    }
    if (key === "ArrowUp") move(1);
    else if (key === "ArrowDown") move(-1);
    else if (key === "Enter") {
      const row = rows[index];
      if (row) pick(row, altKey);
    } else if (key === "Escape") setText("");
    else return false;
    return true;
  };

  const clear = useCallback(() => setDestination(null), []);
  return { picking, rows, index, pick, onKey, destination, clear };
}
