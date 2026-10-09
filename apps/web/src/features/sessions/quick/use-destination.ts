"use client";

import { useEffect, useMemo, useState } from "react";
import type { LiveSessionRow, Project } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { destinationQuery, destinationRows, type Destination, type DestinationRow } from "./destination";

const api = createEngineApi();

type Key = { key: string; altKey: boolean };

export function useDestination({ text, setText, projects, projectId, onProject }: {
  text: string;
  setText: (text: string) => void;
  projects: readonly Project[];
  projectId: string | undefined;
  onProject: (projectId: string) => void;
}) {
  const [sessions, setSessions] = useState<readonly LiveSessionRow[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const query = destinationQuery(text);
  const picking = query !== null;

  useEffect(() => {
    if (!picking) return;
    void api.liveSessions({ all: true }).then((page) => setSessions(page.sessions), () => undefined);
  }, [picking]);

  const rows = useMemo(() => (query === null ? [] : destinationRows(query, projects, sessions, projectId)), [query, projects, sessions, projectId]);
  const index = selection.query === query ? Math.min(selection.index, Math.max(rows.length - 1, 0)) : 0;

  const pick = (row: DestinationRow, worktree: boolean) => {
    setText("");
    if (row.kind === "session") {
      setDestination(row);
      if (row.session.projectId) onProject(row.session.projectId);
    } else {
      onProject(row.project.id);
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
    if (key === "ArrowDown") move(1);
    else if (key === "ArrowUp") move(-1);
    else if (key === "Enter") {
      const row = rows[index];
      if (row) pick(row, altKey);
    } else if (key === "Escape") setText("");
    else return false;
    return true;
  };

  return { picking, rows, index, pick, onKey, destination, clear: () => setDestination(null) };
}
