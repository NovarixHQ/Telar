import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNow } from "./use-now";
import { usePoll, type PollOptions } from "./use-poll";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  jest.useRealTimers();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function mount(node: React.ReactElement) {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(node));
}

const rerender = (node: React.ReactElement) => act(() => root!.render(node));

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

function Poller({ fn, ms, options }: { fn: (signal: AbortSignal) => unknown; ms: number | null; options?: PollOptions }) {
  usePoll(fn, ms, options);
  return null;
}

describe("usePoll", () => {
  test("runs at once, then every period", async () => {
    let calls = 0;
    mount(<Poller fn={() => (calls += 1)} ms={1_000} />);
    expect(calls).toBe(1);
    await advance(3_000);
    expect(calls).toBe(4);
  });

  test("without immediate, waits one period first", async () => {
    let calls = 0;
    mount(<Poller fn={() => (calls += 1)} ms={1_000} options={{ immediate: false }} />);
    expect(calls).toBe(0);
    await advance(1_000);
    expect(calls).toBe(1);
  });

  test("never starts a read while the last one is in flight", async () => {
    let calls = 0;
    let finish: () => void = () => {};
    mount(
      <Poller
        fn={() => {
          calls += 1;
          return new Promise<void>((resolve) => (finish = resolve));
        }}
        ms={1_000}
      />,
    );
    await advance(3_000);
    expect(calls).toBe(1);
    await act(async () => finish());
    await advance(1_000);
    expect(calls).toBe(2);
  });

  test("a null period stops it", async () => {
    let calls = 0;
    const fn = () => (calls += 1);
    mount(<Poller fn={fn} ms={1_000} />);
    rerender(<Poller fn={fn} ms={null} />);
    await advance(5_000);
    expect(calls).toBe(1);
  });

  test("a key change aborts the read in flight and starts over", async () => {
    const signals: AbortSignal[] = [];
    const fn = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(() => {});
    };
    mount(<Poller fn={fn} ms={1_000} options={{ key: "a" }} />);
    rerender(<Poller fn={fn} ms={1_000} options={{ key: "b" }} />);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  test("unmounting aborts and stops", async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    mount(
      <Poller
        fn={(next) => {
          calls += 1;
          signal = next;
        }}
        ms={1_000}
      />,
    );
    act(() => root!.unmount());
    root = undefined;
    await advance(5_000);
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  test("always calls the latest function, without restarting", async () => {
    const seen: string[] = [];
    mount(<Poller fn={() => seen.push("first")} ms={1_000} />);
    rerender(<Poller fn={() => seen.push("second")} ms={1_000} />);
    await advance(1_000);
    expect(seen).toEqual(["first", "second"]);
  });

  test("skips hidden ticks and catches up when shown", async () => {
    let calls = 0;
    mount(<Poller fn={() => (calls += 1)} ms={1_000} />);
    await setVisibility("hidden");
    await advance(3_000);
    expect(calls).toBe(1);
    await setVisibility("visible");
    expect(calls).toBe(2);
  });

  test("an idle backoff doubles the period after each read that finds nothing", async () => {
    let calls = 0;
    mount(<Poller fn={() => (calls += 1)} ms={100} options={{ backoff: true }} />);
    await advance(200 + 400 + 800 + 1_600 + 3_200);
    expect(calls).toBe(6);
  });

  test("a read that resolves true keeps the base period", async () => {
    let calls = 0;
    mount(<Poller fn={() => ((calls += 1), true)} ms={1_000} options={{ backoff: true }} />);
    await advance(5_000);
    expect(calls).toBe(6);
  });

  test("input starts a backed-off period over", async () => {
    let calls = 0;
    mount(<Poller fn={() => (calls += 1)} ms={1_000} options={{ backoff: true }} />);
    await advance(2_000 + 4_000 + 8_000);
    expect(calls).toBe(4);
    await act(async () => window.dispatchEvent(new Event("keydown")));
    await advance(1_000);
    expect(calls).toBe(5);
  });

  test("wake reads at once, and once more after a read in flight", async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const handle = { wake: () => {} };
    function Waker() {
      const wake = usePoll(() => ((calls += 1), new Promise<void>((resolve) => (finish = resolve))), 60_000);
      useEffect(() => {
        handle.wake = wake;
      });
      return null;
    }
    mount(<Waker />);
    expect(calls).toBe(1);
    act(() => handle.wake());
    act(() => handle.wake());
    expect(calls).toBe(1);
    await act(async () => finish());
    expect(calls).toBe(2);
  });
});

async function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
}

function Clock({ ms, seen }: { ms: number; seen: number[] }) {
  seen.push(useNow(ms));
  return null;
}

describe("useNow", () => {
  test("re-reads the clock every period, and only then", async () => {
    const seen: number[] = [];
    mount(<Clock ms={30_000} seen={seen} />);
    const renders = seen.length;
    await advance(29_999);
    expect(seen).toHaveLength(renders);
    await advance(1);
    expect(seen).toHaveLength(renders + 1);
    expect(seen.at(-1)).toBe(Date.now());
  });
});
