import type { ProviderDriverKind, UsageSnapshot } from "@telar/engine-client";
import { driverInput, textGenDisabledByEnv, type TextGenStore } from "./textgen";
import { runTextOrThrow } from "./textgen-run";

export const ONE_SHOT_LIMITS = { promptChars: 8_000, answerChars: 4_000, answerCharsMax: 16_000, timeoutMs: 30_000, timeoutMsMax: 60_000, inFlight: 2 };

export type OneShotRequest = { prompt: string; system?: string; maxChars?: number; timeoutMs?: number };

export type OneShotSpend = { at: number; driver: ProviderDriverKind; model: string; source: string; usage: UsageSnapshot };

type Timers = { set(run: () => void, ms: number): unknown; clear(handle: unknown): void };

export type OneShotDeps = {
  store: TextGenStore;
  spend(entry: OneShotSpend): void;
  run?: typeof runTextOrThrow;
  timers?: Timers;
  now?: () => number;
};

const SYSTEM = "Answer the request in plain text, as briefly as it allows.";

const clamp = (value: number | undefined, fallback: number, max: number) => (typeof value === "number" && value > 0 ? Math.min(Math.floor(value), max) : fallback);

// The text generation policy's provider and cheap model, with no tools and no session; bounded by the prompt and
// answer caps, a timeout that kills the child, and a few calls in flight per source.
export function oneShotCompleter(deps: OneShotDeps) {
  const run = deps.run ?? runTextOrThrow;
  const timers: Timers = deps.timers ?? { set: (handle, ms) => setTimeout(handle, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const inFlight = new Map<string, number>();
  return async (source: string, request: OneShotRequest): Promise<{ text: string }> => {
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("a completion needs a prompt");
    if (prompt.length > ONE_SHOT_LIMITS.promptChars) throw new Error(`the prompt passed ${ONE_SHOT_LIMITS.promptChars} characters`);
    if (textGenDisabledByEnv()) throw new Error("model completions are switched off on this engine");
    const driver = driverInput(deps.store, deps.store.settings.textGen());
    if (!driver) throw new Error("the text generation provider is disabled");
    const running = inFlight.get(source) ?? 0;
    if (running >= ONE_SHOT_LIMITS.inFlight) throw new Error("too many completions are already running");
    inFlight.set(source, running + 1);
    const maxChars = clamp(request.maxChars, ONE_SHOT_LIMITS.answerChars, ONE_SHOT_LIMITS.answerCharsMax);
    const timeoutMs = clamp(request.timeoutMs, ONE_SHOT_LIMITS.timeoutMs, ONE_SHOT_LIMITS.timeoutMsMax);
    const abort = new AbortController();
    let deadline: unknown;
    try {
      const expired = new Promise<never>((_, reject) => {
        deadline = timers.set(() => {
          abort.abort();
          reject(new Error(`the completion took longer than ${timeoutMs / 1000}s`));
        }, timeoutMs);
      });
      const answer = await Promise.race([run({ ...driver, signal: abort.signal, timeoutMs }, prompt, request.system?.trim() || SYSTEM), expired]);
      if (!answer) throw new Error("the completion was stopped");
      if (answer.usage) deps.spend({ at: (deps.now ?? Date.now)(), driver: driver.driver, model: answer.model ?? driver.model ?? "unknown", source, usage: answer.usage });
      const text = answer.text.trim();
      if (text.length > maxChars) throw new Error(`the answer passed ${maxChars} characters`);
      return { text };
    } finally {
      timers.clear(deadline);
      inFlight.set(source, (inFlight.get(source) ?? 1) - 1);
    }
  };
}

export type OneShotCompleter = ReturnType<typeof oneShotCompleter>;
