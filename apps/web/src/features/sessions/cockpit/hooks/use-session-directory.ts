"use client";

import { useEffect, useState } from "react";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";

export type SessionDirectory = ReadonlyMap<string, { title?: string }>;

const EMPTY: SessionDirectory = new Map();

export function useSessionDirectory(hostId: string, sessionIds: readonly string[]): SessionDirectory {
  const wanted = sessionIds.join(",");
  const [directory, setDirectory] = useState<SessionDirectory>(EMPTY);
  useEffect(() => {
    if (!wanted) return;
    let stale = false;
    const ids = new Set(wanted.split(","));
    createEngineApi(hostFetcher(hostId))
      .liveSessions({ all: true })
      .then((list) => {
        if (stale) return;
        setDirectory(new Map(list.sessions.filter((session) => ids.has(session.id)).map((session) => [
          session.id,
          { title: session.title },
        ])));
      }, () => {});
    return () => {
      stale = true;
    };
  }, [hostId, wanted]);
  return directory;
}
