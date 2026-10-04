import type { EngineEvent, SessionDelta } from "@telar/engine-client";

export const DELTA_MAX_EVENTS = 128;
const DELTA_MAX_BYTES = 1_000_000;

export type SessionDeltaStore = {
  queries: {
    eventCursor(sessionId: string): number;
    eventFloor(sessionId: string): number;
    readEvents(sessionId: string, after?: number, limit?: number): EngineEvent[];
  };
};

/** What a cached head needs to catch up, or `reset` when a fresh bootstrap is cheaper or the cursor is not this journal's. */
export function sessionDelta(store: SessionDeltaStore, sessionId: string, after: number): SessionDelta {
  const cursor = store.queries.eventCursor(sessionId);
  if (after > cursor || after < store.queries.eventFloor(sessionId)) return { reset: true };
  const events = store.queries.readEvents(sessionId, after, DELTA_MAX_EVENTS + 1);
  if (events.length > DELTA_MAX_EVENTS) return { reset: true };
  let bytes = 0;
  for (const event of events) {
    bytes += JSON.stringify(event).length;
    if (bytes > DELTA_MAX_BYTES) return { reset: true };
  }
  return { reset: false, events, cursor: Math.max(after, events.at(-1)?.id ?? after) };
}
