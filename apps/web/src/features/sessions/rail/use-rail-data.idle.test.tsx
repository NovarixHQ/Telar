import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { liveRow, project } from "@/test/rail";
import { fakeSessionsStream } from "@/test/sessions-stream";
import { useRailData } from "./use-rail-data";

installTestDom();

let paths: string[] = [];
let stream = fakeSessionsStream();
let streaming = true;

beforeEach(() => {
  jest.useFakeTimers();
  paths = [];
  stream = fakeSessionsStream();
  streaming = true;
  window.localStorage.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input), "http://localhost");
    paths.push(pathname);
    if (pathname === "/api/sessions/stream") return streaming ? stream.answer(init?.signal) : Response.json({}, { status: 404 });
    if (pathname === "/api/hosts") return Response.json({ hosts: [] });
    if (pathname === "/api/sessions/live") return Response.json({ projects: [project("p1", "One")], sessions: [liveRow("a")] });
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
});
afterEach(() => jest.useRealTimers());

function Probe() {
  useRailData();
  return null;
}

async function elapse(ms: number) {
  for (let spent = 0; spent < ms; spent += 1_000) {
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    });
  }
}

const reads = () => paths.filter((path) => path !== "/api/sessions/stream").length;

describe("an idle rail", () => {
  test.each([
    ["with the engine's stream", true],
    ["on an engine without one", false],
  ])("passes less and less often while nothing changes, %s", async (_, withStream) => {
    streaming = withStream;
    await mount(<Probe />);
    await elapse(5_000);
    const before = reads();
    await elapse(60_000);
    expect(reads() - before).toBeLessThanOrEqual(2 * 2);
  });

  test("re-reads at once when the stream reports a row change, and not for streamed tokens", async () => {
    await mount(<Probe />);
    await elapse(60_000);
    const before = reads();
    await act(async () => stream.announce({ sessionId: "a", id: 9, type: "content.delta" }));
    await elapse(1_000);
    expect(reads()).toBe(before);
    await act(async () => stream.announce({ sessionId: "a", id: 10, type: "turn.accepted" }));
    await elapse(1_000);
    expect(reads()).toBe(before + 2);
  });
});
