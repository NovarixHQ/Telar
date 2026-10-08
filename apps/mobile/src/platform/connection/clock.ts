export type Clock = {
  now(): number;
  /** Runs `run` after `ms`; the returned function cancels it. */
  after(ms: number, run: () => void): () => void;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** An abort signal that fires after `ms` or when `parent` aborts. */
export function deadline(clock: Clock, ms: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  const cancel = clock.after(ms, abort);
  const relay = () => controller.abort(parent?.reason);
  if (parent?.aborted) relay();
  parent?.addEventListener("abort", relay);
  return {
    signal: controller.signal,
    clear() {
      cancel();
      parent?.removeEventListener("abort", relay);
    },
  };
}

/** A signal that aborts when any of `signals` does; Hermes has no `AbortSignal.any`. */
export function anyOf(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
