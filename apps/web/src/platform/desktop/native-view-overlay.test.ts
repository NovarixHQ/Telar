import { describe, expect, test } from "bun:test";
import { claimNativeView, createOverlayFreezer, nativeViewCovered, nativeViewOverlayHidden, onNativeViewOverlay, type FrozenFrame } from "@/platform/desktop/native-view-overlay";

describe("the native view is claimed while a menu is open", () => {
  test("the last release is what shows the page again", () => {
    expect(nativeViewOverlayHidden()).toBe(false);
    const first = claimNativeView();
    expect(nativeViewOverlayHidden()).toBe(true);
    // A second menu opening over the first, then the FIRST closing: the view
    // must stay down, or the page would draw over what is still open.
    const second = claimNativeView();
    first();
    expect(nativeViewOverlayHidden()).toBe(true);
    // A release is per claim and idempotent — a double call frees nobody else.
    first();
    expect(nativeViewOverlayHidden()).toBe(true);
    second();
    expect(nativeViewOverlayHidden()).toBe(false);
  });

  test("the live browser is told on subscribe and on every change", () => {
    const seen: boolean[] = [];
    const unsubscribe = onNativeViewOverlay((hidden) => seen.push(hidden));
    // Called once with the current state, so a surface mounting under an open
    // menu does not reveal the page behind it.
    expect(seen).toEqual([false]);
    const release = claimNativeView();
    release();
    expect(seen).toEqual([false, true, false]);
    unsubscribe();
    claimNativeView()();
    expect(seen).toEqual([false, true, false]);
  });
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
const drawnAt = (box: DOMRect) => ({ getBoundingClientRect: () => box }) as Element;

describe("only an overlay that reaches the browser covers it", () => {
  const view = rect(600, 40, 640, 400);

  test("a menu drawn beside the browser leaves it uncovered, one drawn over it covers it", () => {
    const elements = new Set([drawnAt(rect(10, 40, 200, 300))]);
    const release = claimNativeView(elements);
    expect(nativeViewCovered(view)).toBe(false);
    elements.add(drawnAt(rect(560, 60, 200, 300)));
    expect(nativeViewCovered(view)).toBe(true);
    release();
    expect(nativeViewCovered(view)).toBe(false);
  });

  test("an overlay that does not say where it draws covers everything", () => {
    const release = claimNativeView();
    expect(nativeViewCovered(view)).toBe(true);
    release();
  });
});

/** The surface that owns the view, recording each call. `hold` keeps a capture open the way a slow page does. */
function fakeShell() {
  let release: (() => void) | undefined;
  const shell = {
    log: [] as string[],
    frame: { data: "cG5n", mimeType: "image/png", rect: { x: 1, y: 2, width: 3, height: 4 } } as FrozenFrame | null,
    error: null as Error | null,
    hold: false,
    release: () => release?.(),
    capture: async () => {
      shell.log.push("capture");
      if (shell.hold) await new Promise<void>((resolve) => { release = resolve; });
      if (shell.error) throw shell.error;
      return shell.frame;
    },
    paint: async (frame: FrozenFrame | null) => void shell.log.push(frame ? "painted" : "cleared"),
    hide: async () => void shell.log.push("hidden"),
    show: async () => void shell.log.push("shown"),
  };
  return shell;
}

describe("the page stays put behind a menu", () => {
  test("open is one capture, the frame on screen, then one hide; close is one show, then the frame goes", async () => {
    const shell = fakeShell();
    const swap = createOverlayFreezer(shell);
    await swap(true);
    expect(shell.log).toEqual(["capture", "painted", "hidden"]);
    await swap(false);
    expect(shell.log).toEqual(["capture", "painted", "hidden", "shown", "cleared"]);
  });

  test("a second cover while the view is down captures nothing more", async () => {
    const shell = fakeShell();
    const swap = createOverlayFreezer(shell);
    await swap(true);
    await swap(true);
    expect(shell.log).toEqual(["capture", "painted", "hidden"]);
  });

  test("a menu that closes mid-capture never paints, hides or shows", async () => {
    const shell = fakeShell();
    const swap = createOverlayFreezer(shell);
    shell.hold = true;
    const hiding = swap(true);
    await tick();
    const showing = swap(false);
    shell.release();
    await Promise.all([hiding, showing]);
    expect(shell.log).toEqual(["capture"]);
  });

  test("rapid open and close settles on the last state without touching the view", async () => {
    const shell = fakeShell();
    const swap = createOverlayFreezer(shell);
    await Promise.all([swap(true), swap(false), swap(true), swap(false), swap(true), swap(false)]);
    expect(shell.log).toEqual([]);
  });

  test("with no frame the view still goes down, and nothing is cleared on the way back", async () => {
    const shell = fakeShell();
    const swap = createOverlayFreezer(shell);
    shell.frame = null;
    await swap(true);
    await swap(false);
    shell.error = new Error("no frame");
    await swap(true);
    await swap(false);
    expect(shell.log).toEqual(["capture", "hidden", "shown", "capture", "hidden", "shown"]);
  });
});
