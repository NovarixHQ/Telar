/** Every paired client polls at least every 10 s, so three missed polls read as gone. */
export const CONNECTED_WINDOW_MS = 30_000;

/** When each device last passed the gate, held in memory; the store keeps a coarser copy across restarts. */
export function createPresence(now: () => number = Date.now) {
  const seenAt = new Map<string, number>();
  return {
    seen(deviceId: string): void {
      seenAt.set(deviceId, now());
    },
    of(deviceId: string, storedLastSeenAt?: number): { connected: boolean; lastSeenAt?: number } {
      const live = seenAt.get(deviceId);
      const lastSeenAt = Math.max(live ?? 0, storedLastSeenAt ?? 0) || undefined;
      return { connected: live !== undefined && now() - live < CONNECTED_WINDOW_MS, ...(lastSeenAt ? { lastSeenAt } : {}) };
    },
  };
}

export type Presence = ReturnType<typeof createPresence>;
