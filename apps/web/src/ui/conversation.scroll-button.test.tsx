import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StickToBottom, type StickToBottomInstance } from "use-stick-to-bottom";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ConversationScrollButton } = await import("@/ui/conversation");

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function mount(isAtBottom: boolean) {
  const calls: unknown[] = [];
  const instance = {
    scrollRef: createRef<HTMLDivElement>(),
    contentRef: createRef<HTMLDivElement>(),
    isAtBottom,
    isNearBottom: isAtBottom,
    escapedFromLock: !isAtBottom,
    state: {},
    stopScroll: () => {},
    scrollToBottom: async (options?: unknown) => {
      calls.push(options);
      return true;
    },
  } as unknown as StickToBottomInstance;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <StickToBottom instance={instance}>
        <ConversationScrollButton />
      </StickToBottom>,
    ),
  );
  return { host, calls };
}

describe("the scroll-to-end pill", () => {
  test("is hidden at the end of the conversation", () => {
    expect(mount(true).host.querySelector("button")).toBeNull();
  });

  test("shows while reading back, and a click scrolls smoothly to the end", () => {
    const { host, calls } = mount(false);
    const pill = host.querySelector("button")!;
    expect(pill.textContent).toBe("Scroll to end");
    act(() => pill.click());
    expect(calls).toEqual([{ animation: "smooth" }]);
  });
});
