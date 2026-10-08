import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { fakeSessionsStream } from "@/test/sessions-stream";
import { useSessionsStream, type SessionFrame } from "./sessions-stream";

installTestDom();

let asked = 0;
let frames: SessionFrame[] = [];
let opens = 0;

beforeEach(() => {
  jest.useFakeTimers();
  asked = 0;
  frames = [];
  opens = 0;
});
afterEach(() => jest.useRealTimers());

function Listener() {
  useSessionsStream("local", (frame) => frames.push(frame), () => (opens += 1));
  return null;
}

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await act(async () => await Promise.resolve());
}

describe("useSessionsStream", () => {
  test("two listeners share one connection, each hears the frames and the open", async () => {
    const stream = fakeSessionsStream();
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => ((asked += 1), stream.answer(init?.signal))) as typeof fetch;
    await mount(<><Listener /><Listener /></>);
    await settle();
    stream.announce({ sessionId: "s1", id: 3, type: "turn.completed" });
    await settle();
    expect(asked).toBe(1);
    expect(opens).toBe(2);
    expect(frames.map((frame) => frame.type)).toEqual(["turn.completed", "turn.completed"]);
  });

  test("an engine that answers 404 is not asked again", async () => {
    globalThis.fetch = (async () => ((asked += 1), Response.json({}, { status: 404 }))) as unknown as typeof fetch;
    await mount(<Listener />);
    for (let minute = 0; minute < 10; minute += 1) {
      await act(async () => jest.advanceTimersByTime(60_000));
      await settle();
    }
    expect(asked).toBe(1);
    expect(opens).toBe(0);
  });

  test("a dropped connection is retried, and the reopen is announced so missed events are read", async () => {
    let fail = true;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => {
      asked += 1;
      return fail ? Response.json({}, { status: 503 }) : fakeSessionsStream().answer(init?.signal);
    }) as typeof fetch;
    await mount(<Listener />);
    await settle();
    expect(opens).toBe(0);
    fail = false;
    await act(async () => jest.advanceTimersByTime(1_000));
    await settle();
    expect(asked).toBe(2);
    expect(opens).toBe(1);
  });
});
