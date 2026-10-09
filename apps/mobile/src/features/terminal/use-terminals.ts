import type { RunView } from "@telar/engine-client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { HostConnection } from "../../platform/connection";
import { TerminalFeed } from "./feed";
import { keepFollowing, readFrames } from "./stream";
import { upsertTerminal } from "./terminals";

/** The session's terminals, newest first: read once, then kept current by the status stream. */
export function useTerminals(host: HostConnection, sessionId: string): { terminals: RunView[] | undefined; adopt: (run: RunView) => void } {
  const [terminals, setTerminals] = useState<RunView[]>();
  useEffect(() => {
    const abort = new AbortController();
    void keepFollowing(
      async (heard) => {
        const listed = await host.call(true, () => host.client.runStatus(sessionId), abort.signal);
        setTerminals(listed.terminals);
        heard();
        const stream = host.client.locate(`/v2/sessions/${encodeURIComponent(sessionId)}/run/stream`);
        await readFrames(stream, (frame) => frame.type === "run.status" && setTerminals((list) => upsertTerminal(list ?? [], frame.run)), abort.signal);
      },
      abort.signal,
      { first: 2_000, max: 60_000 },
    );
    return () => abort.abort();
  }, [host, sessionId]);
  const adopt = useCallback((run: RunView) => setTerminals((list) => upsertTerminal(list ?? [], run)), []);
  return { terminals, adopt };
}

/** One terminal's live output, resuming from its cursor after every drop. */
export function useTerminalFeed(host: HostConnection, sessionId: string, terminal: RunView) {
  const feed = useMemo(() => new TerminalFeed(terminal), [host, sessionId, terminal.terminalId]);
  useEffect(() => {
    const abort = new AbortController();
    const onFrame = (heard: () => void) => (frame: Parameters<TerminalFeed["absorb"]>[0]) => {
      heard();
      feed.absorb(frame);
    };
    void keepFollowing(
      (heard) => readFrames(host.client.runBytesStream(sessionId, { terminalId: terminal.terminalId, after: feed.cursor }), onFrame(heard), abort.signal),
      abort.signal,
      { first: 1_000, max: 30_000 },
      (error) => feed.fail(error),
    );
    return () => abort.abort();
  }, [feed]);
  return { feed, state: useSyncExternalStore(feed.subscribe, feed.state) };
}
