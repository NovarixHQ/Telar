import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { buttonLabelled, click, flush, installTestDom, mount, stubBoxSize } from "@/test/dom";
import type { SvgImage } from "../svg-image";
import { SvgViewer } from "./svg-viewer";

installTestDom();

stubBoxSize(600, 400);

const image = (width: number, height: number): SvgImage => ({ width, height, url: `data:image/svg+xml,${width}x${height}` });
const percent = (host: HTMLElement) => [...host.querySelectorAll("span")].map((node) => node.textContent).find((text) => text?.endsWith("%"));
const viewer = (host: HTMLElement) => host.querySelector("[role=group]") as HTMLElement;

async function press(host: HTMLElement, key: string) {
  await act(async () => {
    viewer(host).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("inline", () => {
  test("a wide drawing stays readable, clipped, with a way to see the rest", async () => {
    const { host } = await mount(<SvgViewer image={image(3000, 400)} title="Flow" minScale={0.6875} />);
    await flush(() => percent(host) !== "");
    expect(percent(host)).toBe("69%");
    expect(host.textContent).toContain("Drag to see the rest");
  });

  test("the buttons and keys zoom, fit and return to actual size", async () => {
    const { host } = await mount(<SvgViewer image={image(300, 200)} title="Logo" minScale={0.6875} />);
    await flush(() => percent(host) === "100%");
    await click(host.querySelector("[aria-label='Zoom in']")!);
    expect(percent(host)).toBe("125%");
    await press(host, "-");
    expect(percent(host)).toBe("100%");
    await press(host, "-");
    await press(host, "0");
    expect(percent(host)).toBe("100%");
  });

  test("a plain wheel is left to the conversation; ⌘ or ctrl with the wheel zooms", async () => {
    const { host } = await mount(<SvgViewer image={image(300, 200)} title="Logo" minScale={0.6875} />);
    await flush(() => percent(host) === "100%");
    const plain = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    await act(async () => void viewer(host).dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(false);
    expect(percent(host)).toBe("100%");
    const pinch = new WheelEvent("wheel", { deltaY: -50, bubbles: true, cancelable: true });
    Object.defineProperty(pinch, "ctrlKey", { value: true });
    await act(async () => void viewer(host).dispatchEvent(pinch));
    expect(pinch.defaultPrevented).toBe(true);
    expect(percent(host)).not.toBe("100%");
  });
});

describe("across versions", () => {
  function Versions() {
    const [current, setCurrent] = useState(image(1000, 500));
    return (
      <>
        <button type="button" onClick={() => setCurrent(image(1040, 520))}>similar</button>
        <button type="button" onClick={() => setCurrent(image(200, 2000))}>different</button>
        <SvgViewer image={current} title="Flow" minScale={0.6875} />
      </>
    );
  }

  test("it keeps the zoom for a similar version, and lays out a different one afresh", async () => {
    const { host } = await mount(<Versions />);
    await flush(() => percent(host) !== "");
    const opened = percent(host);
    await click(host.querySelector("[aria-label='Zoom in']")!);
    const zoomed = percent(host);
    expect(zoomed).not.toBe(opened);
    await click(buttonLabelled("similar", host));
    expect(percent(host)).toBe(zoomed);
    await click(buttonLabelled("different", host));
    expect(percent(host)).not.toBe(zoomed);
  });

  test("double-click fits, as the Fit button does", async () => {
    const { host } = await mount(<SvgViewer image={image(1000, 500)} title="Flow" minScale={0.6875} />);
    await flush(() => percent(host) !== "");
    await click(buttonLabelled("Fit", host));
    const fitted = percent(host);
    await press(host, "+");
    expect(percent(host)).not.toBe(fitted);
    await act(async () => void viewer(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(percent(host)).toBe(fitted);
  });
});
