// The Swift app's RevealPacer (UI/StreamingReveal.swift): streamed text is revealed at the rate it
// arrives, never more than maxLagMs behind a chunk, so 1 s polls read as steady typing.
const MAX_LAG_MS = 1200;
const RESERVE_MS = 450;
const RESERVE_FLOOR_CHARS = 2;
const DRAIN_SLACK = { min: 0.25, max: 2 };
const ARRIVAL_WEIGHT = 0.3;
export const REVEAL_FRAME_MS = 33;

type Pending = { end: number; at: number };
export type Reveal = { shown: number; target: number; pending: Pending[]; last: number; arrivedAt?: number; arrival?: number };

export const revealed = (length: number, now: number): Reveal => ({ shown: length, target: length, pending: [], last: now });

export function advanceReveal(state: Reveal, now: number): Reveal {
  const elapsed = Math.max(0, now - state.last);
  const pending = state.pending.filter((chunk) => chunk.end > state.shown);
  if (!pending.length) return { ...state, shown: state.target, pending: [], last: now };
  let base = state.shown;
  for (const chunk of pending) if (chunk.at + MAX_LAG_MS - now <= 0) base = Math.max(base, chunk.end);
  let required = 0;
  for (const chunk of pending) {
    const left = chunk.at + MAX_LAG_MS - now;
    if (left > 0 && chunk.end > base) required = Math.max(required, ((chunk.end - base) * 1000) / left);
  }
  let sustained = 0;
  if (state.arrival !== undefined) {
    const backlog = state.target - Math.max(base, state.shown);
    const reserve = Math.max(RESERVE_FLOOR_CHARS, (state.arrival * RESERVE_MS) / 1000);
    sustained = state.arrival * Math.min(DRAIN_SLACK.max, Math.max(DRAIN_SLACK.min, backlog / reserve));
  }
  const shown = Math.min(state.target, Math.max(base, state.shown + (Math.max(required, sustained) * elapsed) / 1000));
  return { ...state, shown, pending: pending.filter((chunk) => chunk.end > shown), last: now };
}

function ingestReveal(state: Reveal, target: number, now: number): Reveal {
  if (target < state.shown) return revealed(target, now);
  if (target <= state.target) return state;
  let arrival = state.arrival;
  if (state.arrivedAt !== undefined && now > state.arrivedAt) {
    const sample = ((target - state.target) * 1000) / (now - state.arrivedAt);
    arrival = arrival === undefined ? sample : arrival * (1 - ARRIVAL_WEIGHT) + sample * ARRIVAL_WEIGHT;
  }
  return { ...state, target, pending: [...state.pending, { end: target, at: now }], arrivedAt: now, ...(arrival === undefined ? {} : { arrival }) };
}

/** New text arrived: a rewrite resets to it whole, a longer prefix is queued for pacing. */
export function stepReveal(state: Reveal, rendered: string, text: string, now: number): Reveal {
  if (!text.startsWith(rendered.slice(0, Math.floor(state.shown))) || text.length < state.shown) return revealed(text.length, now);
  return ingestReveal(advanceReveal(state, now), text.length, now);
}

export const revealText = (text: string, shown: number) => text.slice(0, Math.max(0, Math.floor(shown)));
