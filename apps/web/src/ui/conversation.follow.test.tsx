import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { StickToBottomInstance, StickToBottomState } from "use-stick-to-bottom";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ConversationContent, ConversationViewport } = await import("@/ui/conversation");
type Handle = import("@/ui/conversation").ConversationFollowHandle;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let observers: (() => void)[] = [];
let root: Root | undefined;

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push(() => callback([], this as unknown as ResizeObserver));
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  frames = new Map();
  observers = [];
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

/** A viewport with hand-set geometry; `scrollToBottom` behaves as the library's instant scroll does. */
function mount(start: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  const box = { ...start };
  const scrollRef = createRef<HTMLDivElement>();
  const state = {
    isAtBottom: false,
    escapedFromLock: true,
    animation: undefined,
    get scrollDifference() {
      return box.scrollHeight - box.clientHeight - box.scrollTop;
    },
  } as unknown as StickToBottomState;
  const instance = {
    scrollRef,
    contentRef: createRef<HTMLDivElement>(),
    isAtBottom: false,
    isNearBottom: false,
    escapedFromLock: true,
    state,
    stopScroll: () => {},
    scrollToBottom: async () => {
      state.isAtBottom = true;
      box.scrollTop = box.scrollHeight - box.clientHeight;
      return true;
    },
  } as unknown as StickToBottomInstance;
  const follow = createRef<Handle>();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <ConversationViewport instance={instance} followRef={follow}>
        <ConversationContent>{null}</ConversationContent>
      </ConversationViewport>,
    ),
  );
  const scroller = scrollRef.current!;
  const settle = () => {
    for (let round = 0; round < 3; round++) {
      const pending = [...frames.values()];
      frames.clear();
      for (const frame of pending) frame(performance.now());
    }
  };
  return {
    box,
    state,
    follow,
    atBottom: () => box.scrollHeight - box.clientHeight - box.scrollTop <= 1,
    // What the library does on a scroll it reads as the reader's: it lets go of the bottom.
    layoutScroll: (scrollTop: number) => {
      box.scrollTop = scrollTop;
      state.isAtBottom = false;
      scroller.dispatchEvent(new Event("scroll"));
      settle();
    },
    resize: (patch: Partial<typeof box>) => {
      Object.assign(box, patch);
      for (const notify of observers) notify();
      settle();
    },
    gesture: (event: Event) => {
      scroller.dispatchEvent(event);
      state.isAtBottom = false;
    },
  };
}

describe("sending pins the transcript to the bottom", () => {
  test("from scrolled up, the send lands at the bottom and the turn that arrives after the composer shrinks stays in view", () => {
    const view = mount({ scrollTop: 200, scrollHeight: 2000, clientHeight: 500 });
    act(() => view.follow.current!.toBottom());
    expect(view.atBottom()).toBe(true);

    view.resize({ clientHeight: 600 });
    view.layoutScroll(1400);
    view.resize({ scrollHeight: 2600 });

    expect(view.atBottom()).toBe(true);
    expect(view.state.isAtBottom).toBe(true);
  });

  test("turns above re-measuring after the send still leave it at the bottom", () => {
    const view = mount({ scrollTop: 0, scrollHeight: 3000, clientHeight: 500 });
    act(() => view.follow.current!.toBottom());

    view.resize({ scrollHeight: 2400 });
    view.layoutScroll(1700);
    view.resize({ scrollHeight: 2900 });

    expect(view.atBottom()).toBe(true);
  });

  test("steering into a streaming turn keeps following each chunk", () => {
    const view = mount({ scrollTop: 300, scrollHeight: 2000, clientHeight: 500 });
    act(() => view.follow.current!.toBottom());

    for (const height of [2200, 2500, 2900]) {
      view.layoutScroll(view.box.scrollTop - 10);
      view.resize({ scrollHeight: height });
      expect(view.atBottom()).toBe(true);
    }
  });

  test("the reader scrolling up lets go, and later output does not pull them back", () => {
    const view = mount({ scrollTop: 300, scrollHeight: 2000, clientHeight: 500 });
    act(() => view.follow.current!.toBottom());

    view.gesture(new WheelEvent("wheel", { deltaY: -120 }));
    view.layoutScroll(900);
    view.resize({ scrollHeight: 2600 });

    expect(view.box.scrollTop).toBe(900);
  });
});
