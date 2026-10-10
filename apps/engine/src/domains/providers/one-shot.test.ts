import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_TEXT_GEN_POLICY, type TextGenPolicy } from "@telar/engine-client";
import { ONE_SHOT_LIMITS, oneShotCompleter, type OneShotSpend } from "./one-shot";
import type { TextAnswer, TextGenDriverInput } from "./textgen-run";

let previous: string | undefined;
beforeEach(() => {
  previous = process.env.TELAR_TEXTGEN;
  delete process.env.TELAR_TEXTGEN;
});
afterEach(() => {
  if (previous === undefined) delete process.env.TELAR_TEXTGEN;
  else process.env.TELAR_TEXTGEN = previous;
});

function store(policy: TextGenPolicy = DEFAULT_TEXT_GEN_POLICY, enabled = true) {
  return {
    settings: { textGen: () => policy },
    providers: { resolve: () => ({ enabled, binaryPath: "/fake/claude", env: [] }) },
  };
}

function manualTimers() {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  return {
    set: (run: () => void, ms: number) => (pending.set(++next, { run, ms }), next),
    clear: (handle: unknown) => void pending.delete(handle as number),
    fire: () => [...pending.values()].forEach(({ run }) => run()),
    delays: () => [...pending.values()].map(({ ms }) => ms),
  };
}

function setup(answer: (input: TextGenDriverInput, prompt: string, system: string) => Promise<TextAnswer | undefined>, options: { enabled?: boolean } = {}) {
  const calls: { input: TextGenDriverInput; prompt: string; system: string }[] = [];
  const spent: OneShotSpend[] = [];
  const timers = manualTimers();
  const complete = oneShotCompleter({
    store: store(DEFAULT_TEXT_GEN_POLICY, options.enabled ?? true),
    spend: (entry) => spent.push(entry),
    timers,
    now: () => 1_000,
    run: (input, prompt, system) => {
      calls.push({ input, prompt, system });
      return answer(input, prompt, system);
    },
  });
  return { complete, calls, spent, timers };
}

const usage = { tokens: { input: 12, output: 5, cacheRead: 0, cacheCreate: 0 }, costUsd: 0.0001 };

describe("one-shot completion", () => {
  test("runs on the policy's cheap model with no session, and records what it spent", async () => {
    const { complete, calls, spent } = setup(async () => ({ text: "  x^2  ", model: "claude-haiku-4-5", usage }));
    expect(await complete("plugin:latex", { prompt: "x squared", system: "LaTeX only." })).toEqual({ text: "x^2" });
    expect(calls[0]).toMatchObject({ prompt: "x squared", system: "LaTeX only.", input: { driver: "claude", model: "haiku", binaryPath: "/fake/claude" } });
    expect(spent).toEqual([{ at: 1_000, driver: "claude", model: "claude-haiku-4-5", source: "plugin:latex", usage }]);
  });

  test("refuses an empty or oversized prompt before spawning anything", async () => {
    const { complete, calls } = setup(async () => ({ text: "never" }));
    await expect(complete("plugin:x", { prompt: "   " })).rejects.toThrow("needs a prompt");
    await expect(complete("plugin:x", { prompt: "a".repeat(ONE_SHOT_LIMITS.promptChars + 1) })).rejects.toThrow("prompt passed");
    expect(calls).toHaveLength(0);
  });

  test("an answer over the cap fails, but its cost is still counted", async () => {
    const { complete, spent } = setup(async () => ({ text: "y".repeat(120), usage }));
    await expect(complete("plugin:x", { prompt: "go", maxChars: 100 })).rejects.toThrow("answer passed 100 characters");
    await Promise.resolve();
    expect(spent).toHaveLength(1);
  });

  test("a caller cannot raise the caps past the engine's maximum", async () => {
    const { complete, calls, timers } = setup(async () => ({ text: "ok" }));
    await complete("plugin:x", { prompt: "go", timeoutMs: 10 * 60_000, maxChars: 1_000_000 });
    expect(calls[0]!.input.timeoutMs).toBe(ONE_SHOT_LIMITS.timeoutMsMax);
    expect(timers.delays()).toEqual([]);
  });

  test("a provider that never answers is stopped at the timeout", async () => {
    let signal: AbortSignal | undefined;
    const { complete, timers } = setup((input) => {
      signal = input.signal;
      return new Promise(() => undefined);
    });
    const pending = complete("plugin:x", { prompt: "go", timeoutMs: 5_000 });
    expect(timers.delays()).toEqual([5_000]);
    timers.fire();
    await expect(pending).rejects.toThrow("took longer than 5s");
    expect(signal?.aborted).toBe(true);
  });

  test("only a few calls run at once per source", async () => {
    const release: (() => void)[] = [];
    const { complete } = setup(() => new Promise((resolve) => release.push(() => resolve({ text: "done" }))));
    const running = [complete("plugin:x", { prompt: "1" }), complete("plugin:x", { prompt: "2" })];
    await expect(complete("plugin:x", { prompt: "3" })).rejects.toThrow("too many completions");
    const other = complete("plugin:y", { prompt: "elsewhere" });
    release.forEach((done) => done());
    expect(await Promise.all([...running, other])).toEqual([{ text: "done" }, { text: "done" }, { text: "done" }]);
    const again = complete("plugin:x", { prompt: "4" });
    release.at(-1)!();
    expect(await again).toEqual({ text: "done" });
  });

  test("is refused when text generation is off or its provider is disabled", async () => {
    await expect(setup(async () => ({ text: "x" }), { enabled: false }).complete("plugin:x", { prompt: "go" })).rejects.toThrow("provider is disabled");
    process.env.TELAR_TEXTGEN = "off";
    await expect(setup(async () => ({ text: "x" })).complete("plugin:x", { prompt: "go" })).rejects.toThrow("switched off");
  });
});
