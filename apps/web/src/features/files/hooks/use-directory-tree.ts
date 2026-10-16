"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceEntry } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";

const api = createEngineApi();

type Levels = ReadonlyMap<string, readonly WorkspaceEntry[]>;

const NONE: Levels = new Map();

/** The tree read from disk one folder at a time: the root, then each folder as it is expanded. */
export function useDirectoryTree(sessionId: string | undefined, projectId: string | undefined, expanded: ReadonlySet<string>) {
  const scope = sessionId ? `session:${sessionId}` : projectId ? `project:${projectId}` : "";
  const [read, setRead] = useState<{ scope: string; levels: Levels }>({ scope, levels: NONE });
  const levels = read.scope === scope ? read.levels : NONE;
  const reading = useRef(new Set<string>());
  const shown = useRef({ scope, levels, expanded });
  useEffect(() => {
    shown.current = { scope, levels, expanded };
  });

  const readLevel = useCallback(
    async (dir: string): Promise<readonly WorkspaceEntry[]> => {
      if (!sessionId && !projectId) return [];
      const listed = await (sessionId ? api.sessionDirectory(sessionId, dir) : api.projectDirectory(projectId!, dir)).catch(() => undefined);
      return listed?.directory.entries ?? [];
    },
    [sessionId, projectId],
  );

  const store = useCallback(
    (update: (current: Levels) => Levels) =>
      setRead((current) => (shown.current.scope !== scope ? current : { scope, levels: update(current.scope === scope ? current.levels : NONE) })),
    [scope],
  );

  useEffect(() => {
    if (!scope) return;
    const missing = ["", ...expanded].filter((dir) => !levels.has(dir) && !reading.current.has(`${scope}\0${dir}`));
    for (const dir of missing) {
      const key = `${scope}\0${dir}`;
      reading.current.add(key);
      void readLevel(dir).then((entries) => {
        reading.current.delete(key);
        store((current) => new Map(current).set(dir, entries));
      });
    }
  }, [scope, levels, expanded, readLevel, store]);

  /** Re-reads every folder on screen in one pass, so a file that appeared or went away shows at once. */
  const reload = useCallback(async () => {
    const { levels: current, expanded: open } = shown.current;
    const dirs = [...current.keys()].filter((dir) => dir === "" || open.has(dir));
    if (dirs.length === 0) return;
    const fresh = new Map(await Promise.all(dirs.map(async (dir) => [dir, await readLevel(dir)] as const)));
    store(() => fresh);
  }, [readLevel, store]);

  return useMemo(() => ({ levels, loaded: levels.has(""), reload }), [levels, reload]);
}
