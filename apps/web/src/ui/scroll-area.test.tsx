import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount, flush } from "@/test/dom";
import { ScrollArea } from "./scroll-area";

installTestDom();

async function strip(content: number, box: number) {
  const { host } = await mount(
    <ScrollArea orientation="horizontal" viewportProps={{ role: "tablist" }}>
      <span>one</span>
      <span>two</span>
    </ScrollArea>,
  );
  const viewport = host.querySelector<HTMLElement>('[role="tablist"]')!;
  const size = { scrollWidth: content, clientWidth: box, scrollHeight: 28, clientHeight: 28 };
  for (const [key, value] of Object.entries(size)) Object.defineProperty(viewport, key, { configurable: true, value });
  const root = host.querySelector('[data-slot="scroll-area"]')!;
  const scrollTo = async (left: number) => {
    viewport.scrollLeft = left;
    await act(async () => void viewport.dispatchEvent(new Event("scroll")));
    await flush();
  };
  return { viewport, root, scrollTo };
}

const fades = (root: Element) => ({ start: root.hasAttribute("data-overflow-x-start"), end: root.hasAttribute("data-overflow-x-end") });

describe("a horizontal strip's edge fade", () => {
  test("a strip that fits fades neither edge", async () => {
    const { root, scrollTo } = await strip(200, 200);
    await scrollTo(0);
    expect(fades(root)).toEqual({ start: false, end: false });
  });

  test("an overflowing strip fades the side that has more, and both in the middle", async () => {
    const { root, scrollTo } = await strip(500, 200);
    await scrollTo(0);
    expect(fades(root)).toEqual({ start: false, end: true });
    await scrollTo(150);
    expect(fades(root)).toEqual({ start: true, end: true });
    await scrollTo(300);
    expect(fades(root)).toEqual({ start: true, end: false });
  });
});

describe("a mouse wheel on a horizontal strip", () => {
  test("moves the strip sideways when it overflows", async () => {
    const { viewport } = await strip(500, 200);
    await act(async () => void viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true })));
    expect(viewport.scrollLeft).toBe(40);
  });

  test("leaves a strip that fits alone", async () => {
    const { viewport } = await strip(200, 200);
    await act(async () => void viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true })));
    expect(viewport.scrollLeft).toBe(0);
  });
});
