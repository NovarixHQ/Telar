"use client";

import { useCallback, useEffect, useRef } from "react";
import { hostVisible, subscribeHostVisibility } from "@/platform/desktop/host-visibility";

export type PollOptions = {
  /** Run once on mount instead of waiting a full period. Default true. */
  immediate?: boolean;
  /** Restart the poll (aborting the read in flight) when this changes. */
  key?: unknown;
  /** Double the period after each read that does not resolve `true`, up to `IDLE_POLL_MAX_MS`; input, focus or showing again start over. */
  backoff?: boolean;
};

export const IDLE_POLL_MAX_MS = 120_000;
const ACTIVITY = ["pointerdown", "keydown", "focus"] as const;

/**
 * Calls `fn` every `ms`, never overlapping a read still in flight; `null` stops it, a hidden window skips ticks.
 * `fn` gets a signal aborted on unmount and on `key` change; it handles its own errors.
 * Returns `wake`: read now (or right after the read in flight) and start the period over.
 */
export function usePoll(fn: (signal: AbortSignal) => unknown, ms: number | null, { immediate = true, key, backoff = false }: PollOptions = {}): () => void {
  const latest = useRef(fn);
  const waker = useRef(() => {});
  useEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    if (ms === null) return;
    const controller = new AbortController();
    let running = false;
    let again = false;
    let delay = ms;
    let timer: number | undefined;
    let dueAt = 0;
    const schedule = (wait: number) => {
      window.clearTimeout(timer);
      dueAt = Date.now() + wait;
      timer = window.setTimeout(run, wait);
    };
    const settle = (changed: boolean) => {
      running = false;
      if (controller.signal.aborted) return;
      if (backoff) delay = changed ? ms : Math.min(delay * 2, Math.max(ms, IDLE_POLL_MAX_MS));
      if (again) {
        again = false;
        run();
      } else schedule(delay);
    };
    function run() {
      if (controller.signal.aborted || !hostVisible()) return;
      if (running) {
        again = true;
        return;
      }
      window.clearTimeout(timer);
      const result = latest.current(controller.signal);
      if (!(result instanceof Promise)) return settle(result === true);
      running = true;
      result.then(
        (value) => settle(value === true),
        () => settle(false),
      );
    }
    const restart = () => {
      if (delay === ms) return;
      delay = ms;
      if (!running && dueAt - Date.now() > ms) schedule(ms);
    };
    const onVisibility = () => {
      if (!hostVisible()) return;
      delay = ms;
      run();
    };
    waker.current = () => {
      delay = ms;
      run();
    };
    if (immediate) run();
    else schedule(ms);
    const unsubscribe = subscribeHostVisibility(onVisibility);
    if (backoff) for (const type of ACTIVITY) window.addEventListener(type, restart, true);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      unsubscribe();
      waker.current = () => {};
      if (backoff) for (const type of ACTIVITY) window.removeEventListener(type, restart, true);
    };
  }, [ms, key, immediate, backoff]);

  return useCallback(() => waker.current(), []);
}
