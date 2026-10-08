import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, useEffect, useState } from "react";
import type { SessionChild } from "@telar/engine-client";
import { installTestDom, mount } from "@/test/dom";
import { CHILDREN_IDLE_MS, CHILDREN_LIVE_MS, useSessionChildren } from "./use-session-children";

installTestDom();

const child = (sessionId: string, state: SessionChild["state"]): SessionChild => ({ sessionId, parentSessionId: "parent", state, startedAt: 1 });

let answers: Record<string, SessionChild[]>;
let reads: string[];

beforeEach(() => {
  jest.useFakeTimers();
  answers = {};
  reads = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/sessions/stream") return new Response(null, { status: 404 });
    reads.push(path);
    const id = /\/api\/sessions\/([^/]+)\/children$/.exec(path)?.[1] ?? "";
    return Response.json({ children: answers[id] ?? [] });
  }) as typeof fetch;
});
afterEach(() => jest.useRealTimers());

let seen: readonly SessionChild[] = [];
const see = (children: readonly SessionChild[]) => {
  seen = children;
};
function Probe({ sessionId, growth = 0 }: { sessionId?: string; growth?: number }) {
  see(useSessionChildren("local", sessionId, growth));
  return null;
}

let grow = () => {};
const exposeGrow = (next: () => void) => {
  grow = next;
};
function Growing() {
  const [growth, setGrowth] = useState(1);
  useEffect(() => exposeGrow(() => setGrowth((current) => current + 1)), []);
  return <Probe sessionId="parent" growth={growth} />;
}

let switchTo: (id: string) => void = () => {};
const exposeSwitch = (next: (id: string) => void) => {
  switchTo = next;
};
function Switching() {
  const [id, setId] = useState("parent");
  useEffect(() => exposeSwitch(setId), []);
  return <Probe sessionId={id} />;
}

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await act(async () => await Promise.resolve());
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

describe("useSessionChildren", () => {
  test("reads at once, every few seconds while a child works, and less and less often once all have ended", async () => {
    answers.parent = [child("a", "working")];
    await mount(<Probe sessionId="parent" />);
    await settle();
    expect(seen.map((each) => each.state)).toEqual(["working"]);
    expect(reads).toHaveLength(1);
    await advance(CHILDREN_LIVE_MS);
    expect(reads).toHaveLength(2);
    answers.parent = [child("a", "done")];
    await advance(CHILDREN_LIVE_MS);
    expect(seen.map((each) => each.state)).toEqual(["done"]);
    const before = reads.length;
    await advance(CHILDREN_LIVE_MS);
    expect(reads).toHaveLength(before);
    for (let waited = 0; waited < 60_000; waited += 5_000) await advance(5_000);
    expect(reads.length - before).toBeGreaterThan(0);
    expect(reads.length - before).toBeLessThanOrEqual(2);
  });

  test("a grown transcript reads again without waiting for the next tick", async () => {
    await mount(<Growing />);
    await settle();
    expect(reads).toHaveLength(1);
    answers.parent = [child("a", "working")];
    await act(async () => grow());
    await settle();
    expect(reads).toHaveLength(2);
    expect(seen.map((each) => each.sessionId)).toEqual(["a"]);
  });

  test("another session never shows the last one's children", async () => {
    answers.parent = [child("a", "working")];
    await mount(<Switching />);
    await settle();
    expect(seen).toHaveLength(1);
    await act(async () => switchTo("other"));
    expect(seen).toEqual([]);
  });

  test("an engine that answers 404 is never asked again for that session", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path !== "/api/sessions/stream") reads.push(path);
      return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
    }) as typeof fetch;
    await mount(<Growing />);
    await settle();
    expect(reads).toHaveLength(1);
    await act(async () => grow());
    for (let tick = 0; tick < 3; tick += 1) await advance(CHILDREN_IDLE_MS);
    expect(reads).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  test("no session reads nothing", async () => {
    await mount(<Probe />);
    for (let waited = 0; waited < CHILDREN_IDLE_MS; waited += CHILDREN_LIVE_MS) await advance(CHILDREN_LIVE_MS);
    expect(reads).toEqual([]);
    expect(seen).toEqual([]);
  });
});
