import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, Fragment, useState } from "react";
import type { Session } from "@telar/engine-client";
import { installTestDom, mount } from "@/test/dom";
import { ReadReceiptMarker, useReadReceipt } from "./read-receipt";
import type { useSessionSync } from "../hooks/use-session-sync";

installTestDom();

let atBottom = true;
const live = new Set<FakeObserver>();
class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  report() {
    this.callback([{ isIntersecting: atBottom } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  observe() {
    live.add(this);
    setTimeout(() => live.has(this) && this.report(), 16);
  }
  disconnect() {
    live.delete(this);
  }
}

async function scrollTo(bottom: boolean) {
  atBottom = bottom;
  await act(async () => {
    for (const observer of live) observer.report();
  });
}

async function wait(ms: number) {
  for (let spent = 0; spent < ms; spent += 50) await act(async () => jest.advanceTimersByTime(50));
}

let sent: { url: string; body: unknown }[] = [];
let realObserver: unknown;
let realHasFocus: () => boolean;
beforeEach(() => {
  jest.useFakeTimers();
  atBottom = true;
  sent = [];
  realObserver = globalThis.IntersectionObserver;
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
  realHasFocus = document.hasFocus.bind(document);
  document.hasFocus = () => true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { runId: string };
    sent.push({ url: String(input), body });
    const sequence = Number(body.runId.replace("run_", ""));
    return Response.json({ session: { ...session(0), lastReadTurnSequence: sequence } });
  }) as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = realObserver;
  document.hasFocus = realHasFocus;
});

function session(read: number): Session {
  return { id: "session_a", projectId: "project_a", lastReadTurnSequence: read } as Session;
}

const turn = (sequence: number, state: "completed" | "running" = "completed") => ({ runId: `run_${sequence}`, sequence, state });

type Turn = ReturnType<typeof turn>;
let setTurns: (turns: Turn[]) => void = () => undefined;
let setWrap: (wrap: number) => void = () => undefined;

function Harness({ hostId, initial }: { hostId: string; initial: Turn[] }) {
  const [turns, set] = useState(initial);
  const [current, setSession] = useState<Session | undefined>(session(initial.length > 1 ? 1 : 0));
  const [wrap, rewrap] = useState(0);
  setTurns = set;
  setWrap = rewrap;
  const sync = { session: current, turns, loading: false, setSession } as unknown as ReturnType<typeof useSessionSync>;
  const receipt = useReadReceipt(hostId, "session_a", sync);
  return (
    <Fragment key={wrap}>
      <p data-read={current?.lastReadTurnSequence ?? 0} />
      {receipt.newestResult && <ReadReceiptMarker markerRef={receipt.markerRef} />}
    </Fragment>
  );
}

const readSequence = (host: HTMLElement) => Number(host.querySelector("p")?.dataset.read);

describe("read receipt", () => {
  test("opening a session already at the bottom marks it read without a scroll", async () => {
    const { host } = await mount(<Harness hostId="local" initial={[turn(1), turn(2)]} />);
    await wait(2_000);
    expect(sent.map((entry) => entry.body)).toEqual([{ runId: "run_2" }]);
    expect(readSequence(host)).toBe(2);
  });

  test("a marker that remounts while visible still marks the answer read", async () => {
    const { host } = await mount(<Harness hostId="local" initial={[turn(1), turn(2)]} />);
    await act(async () => setWrap(1));
    await wait(2_000);
    expect(sent.map((entry) => entry.body)).toEqual([{ runId: "run_2" }]);
    expect(readSequence(host)).toBe(2);
  });

  test("a transcript that keeps streaming still marks the open answer read", async () => {
    const { host } = await mount(<Harness hostId="local" initial={[turn(1), turn(2), turn(3, "running")]} />);
    for (let tick = 0; tick < 10; tick += 1) {
      await act(async () => setTurns([turn(1), turn(2), turn(3, "running")]));
      await wait(200);
    }
    expect(readSequence(host)).toBe(2);
  });

  test("an answer that lands while at the bottom is marked read", async () => {
    const { host } = await mount(<Harness hostId="local" initial={[turn(1), turn(2)]} />);
    await wait(2_000);
    await act(async () => setTurns([turn(1), turn(2), turn(3)]));
    await wait(2_000);
    expect(sent.map((entry) => entry.body)).toEqual([{ runId: "run_2" }, { runId: "run_3" }]);
    expect(readSequence(host)).toBe(3);
  });

  test("an answer that lands while scrolled up waits until the reader scrolls down", async () => {
    const { host } = await mount(<Harness hostId="local" initial={[turn(1), turn(2)]} />);
    await wait(2_000);
    await scrollTo(false);
    await act(async () => setTurns([turn(1), turn(2), turn(3)]));
    await wait(2_000);
    expect(readSequence(host)).toBe(2);
    await scrollTo(true);
    await wait(2_000);
    expect(readSequence(host)).toBe(3);
  });

  test("a remote cockpit marks the answer read on the host that owns the session", async () => {
    await mount(<Harness hostId="host_7f3a" initial={[turn(1), turn(2)]} />);
    await wait(2_000);
    expect(sent).toEqual([{ url: "/api/hosts/host_7f3a/sessions/session_a/read", body: { runId: "run_2" } }]);
  });
});
