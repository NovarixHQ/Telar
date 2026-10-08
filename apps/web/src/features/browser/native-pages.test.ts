import { describe, expect, test } from "bun:test";
import { closeNativePage, nativePageToShow } from "./native-pages";
import type { DesktopBrowserBridge, DesktopBrowserTab } from "./types";

function fakeBridge(ids: string[], active?: string) {
  let pages = ids;
  const calls: unknown[] = [];
  const tabs = (): DesktopBrowserTab[] => pages.map((id, index) => ({ id, index, active: id === active, title: id, url: "", loading: false, canGoBack: false, canGoForward: false }));
  const bridge = {
    getState: async (scopeKey: string) => ({ scopeKey, tabs: tabs() }),
    action: async (scopeKey: string, action: { action: string; index: number }) => {
      calls.push(["action", scopeKey, action]);
      pages = pages.filter((_, index) => index !== action.index);
      return { scopeKey, tabs: tabs() };
    },
    releaseScope: async (...args: unknown[]) => void calls.push(["release", ...args]),
  } as unknown as DesktopBrowserBridge;
  return { bridge, calls };
}

describe("closeNativePage", () => {
  test("closes that page by its current index", async () => {
    const { bridge, calls } = fakeBridge(["a", "b", "c"]);
    await closeNativePage(bridge, "s1", "b");
    expect(calls).toEqual([["action", "s1", { action: "close", index: 1 }]]);
  });

  test("two closes at once each close their own page", async () => {
    const { bridge, calls } = fakeBridge(["a", "b", "c"]);
    await Promise.all([closeNativePage(bridge, "s1", "a"), closeNativePage(bridge, "s1", "c")]);
    expect(calls).toEqual([
      ["action", "s1", { action: "close", index: 0 }],
      ["action", "s1", { action: "close", index: 1 }],
    ]);
  });

  test("closing the last page releases the scope as the person's close", async () => {
    const { bridge, calls } = fakeBridge(["a"]);
    await closeNativePage(bridge, "s1", "a");
    expect(calls).toEqual([["release", "s1", true, { closedByPerson: true }]]);
  });

  test("a page the shell no longer has closes nothing", async () => {
    const { bridge, calls } = fakeBridge(["a", "b"]);
    await closeNativePage(bridge, "s1", "gone");
    expect(calls).toEqual([]);
  });
});

describe("nativePageToShow", () => {
  test("is the active page, else the last, else nothing", async () => {
    expect(await nativePageToShow(fakeBridge(["a", "b", "c"], "b").bridge, "s1")).toBe("b");
    expect(await nativePageToShow(fakeBridge(["a", "b"]).bridge, "s1")).toBe("b");
    expect(await nativePageToShow(fakeBridge([]).bridge, "s1")).toBeUndefined();
  });
});
