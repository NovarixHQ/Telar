"use client";

import { useRef, useState } from "react";
import { usePoll } from "@/ui/hooks/use-poll";
import { ITEM_CHARS } from "../frames";
import { byteFeed, type RunByteFeed } from "../run/terminal-feed";
import { ptyByteWriter } from "../session";
import type { RunEmulator } from "./use-run-emulator";

function redraw(emulator: RunEmulator, feed: Pick<RunByteFeed, "chunks" | "reset">) {
  const term = emulator.termRef.current;
  if (!term) return;
  if (feed.reset) {
    term.reset();
    emulator.writeRef.current = ptyByteWriter(term);
  }
  const write = emulator.writeRef.current ?? ptyByteWriter(term);
  // Never one item longer than ITEM_CHARS: xterm's parser yields only between items.
  for (const chunk of feed.chunks) for (let at = 0; at < chunk.length; at += ITEM_CHARS) write(chunk.slice(at, at + ITEM_CHARS));
}

/** The run's bytes, drawn into its emulator. Returns how many chunks are not on screen. */
export function useRunFeed(emulator: RunEmulator, { sessionId, runId, live }: { sessionId: string; runId: string; live: boolean }) {
  const [dropped, setDropped] = useState(0);
  const cursor = useRef(0);
  const skipped = useRef(0);
  // A settled run is read once more and then left alone.
  const settledRead = useRef(false);
  usePoll(
    async () => {
      const { api, sessionId: session, runId: run, live: running } = emulator.latest.current;
      if (!running && settledRead.current) return;
      try {
        const answer = await api.bytes(session, { runId: run, after: cursor.current });
        const next = byteFeed(cursor.current, answer);
        cursor.current = next.cursor;
        if (next.reset || next.skipped > 0) skipped.current = next.skipped;
        setDropped(answer.dropped + skipped.current);
        redraw(emulator, next);
        if (!running) settledRead.current = true;
      } catch {
        // The status feed reports refusals; retrying slowly beats a tight loop.
      }
    },
    live ? 500 : 4000,
    { key: `${sessionId}:${runId}:${live}` },
  );
  return dropped;
}
