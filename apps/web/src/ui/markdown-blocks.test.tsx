import { expect, test } from "bun:test";
import { act } from "react";
import { flush, installTestDom, mount } from "@/test/dom";
import { MessageResponse } from "@/ui/message";

installTestDom();

const click = (element: Element | null) => act(async () => (element as HTMLElement).click());

test("a code block offers a wrap toggle beside copy, and pressing it turns wrapping on and off", async () => {
  const { host } = await mount(<MessageResponse>{"```ts\nconst long = 1;\n```"}</MessageResponse>);
  expect(host.querySelector('[data-streamdown="code-block-copy-button"]')).not.toBeNull();
  const toggle = host.querySelector('button[aria-label="Wrap lines"]');
  expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  await click(toggle);
  expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  expect(toggle?.getAttribute("aria-label")).toBe("Don't wrap lines");
  await click(toggle);
  expect(toggle?.getAttribute("aria-pressed")).toBe("false");
});

test("inline code stays inline, with no controls", async () => {
  const { host } = await mount(<MessageResponse>{"run `bun test` now"}</MessageResponse>);
  expect(host.querySelector('[data-streamdown="inline-code"]')?.textContent).toBe("bun test");
  expect(host.querySelector('button[aria-label="Wrap lines"]')).toBeNull();
});

test("clicking an image in a reply opens it in the zoom view", async () => {
  const { host } = await mount(<MessageResponse>{"![chart](https://example.com/chart.png)"}</MessageResponse>);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(host.querySelector('[role="button"][aria-label="Open image: chart"]'));
  await flush(() => document.querySelector('[role="dialog"]') !== null);
  expect(document.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe("https://example.com/chart.png");
});

test("an image that fails to load says so and opens nothing", async () => {
  const { host } = await mount(<MessageResponse>{"![chart](https://example.com/chart.png)"}</MessageResponse>);
  await act(async () => void host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector('[aria-label="Open image: chart"]')).toBeNull();
  expect(host.textContent).toContain("Image not available");
});
