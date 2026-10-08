import { useCallback, useSyncExternalStore } from "react";
import type { HostConnection } from "../../platform/connection";
import { SessionFeed, type FeedSnapshot } from "./feed";

const held = new Map<string, { feed: SessionFeed; holders: number }>();
const EMPTY: FeedSnapshot = { turns: [] };

export function feedOf(host: HostConnection | undefined, sessionId: string): SessionFeed | undefined {
  return host ? held.get(`${host.hostId}/${sessionId}`)?.feed : undefined;
}

/** A session is tailed while some view shows it; the last view to leave stops the tail. */
export function useFeed(host: HostConnection | undefined, sessionId: string): FeedSnapshot {
  const key = host ? `${host.hostId}/${sessionId}` : undefined;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!host || !key) return () => {};
      let entry = held.get(key);
      if (!entry) held.set(key, (entry = { feed: new SessionFeed(host, sessionId), holders: 0 }));
      entry.holders += 1;
      if (entry.holders === 1) entry.feed.start();
      const stop = entry.feed.subscribe(listener);
      return () => {
        stop();
        entry.holders -= 1;
        if (entry.holders > 0) return;
        entry.feed.stop();
        held.delete(key);
      };
    },
    [host, key, sessionId],
  );
  return useSyncExternalStore(subscribe, () => (key ? held.get(key)?.feed.snapshot : undefined) ?? EMPTY);
}
