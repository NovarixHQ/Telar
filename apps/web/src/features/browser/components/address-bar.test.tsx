import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { nativeViewOverlayHidden } from "@/platform/desktop/native-view-overlay";
import type { BrowserHistoryEntry, DesktopBrowserTab } from "../types";
import { AddressBar } from "./address-bar";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HISTORY: BrowserHistoryEntry[] = [
  { url: "https://github.com/telar", title: "Telar on GitHub", visits: 5, lastVisit: Date.now() },
  { url: "http://localhost:3000/", title: "Dev server", visits: 2, lastVisit: Date.now() },
];
const TABS: DesktopBrowserTab[] = [
  { index: 0, id: "a", title: "Current", url: "https://current.example/", active: true, loading: false, canGoBack: false, canGoForward: false },
  { index: 1, id: "b", title: "Gmail", url: "https://mail.google.com/", active: false, loading: false, canGoBack: false, canGoForward: false, favicon: "https://mail.google.com/favicon.ico" },
];

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});
afterAll(() => GlobalRegistrator.unregister());

async function mount() {
  const opened: string[] = [];
  const selected: number[] = [];
  const inputRef = createRef<HTMLInputElement>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <AddressBar
        url="https://current.example/"
        tabs={TABS}
        inputRef={inputRef}
        loadHistory={async () => HISTORY}
        onOpen={(url) => opened.push(url)}
        onSelectTab={(index) => selected.push(index)}
        onTyping={() => {}}
      />,
    );
  });
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    input.focus();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    await Promise.resolve();
  });
  return { input, opened, selected };
}

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(input: HTMLInputElement, value: string, inputType = "insertText") {
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
  });
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const options = () => [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent);

test("typing lists matching tabs and pages over the page, then a search row", async () => {
  const { input } = await mount();
  await type(input, "telar");
  expect(options()).toEqual(["Telar on GitHubgithub.com/telar", "Search for “telar”"]);
  expect(nativeViewOverlayHidden()).toBe(true);
  await type(input, "mail");
  expect(options()[0]).toContain("Switch to tab");
  await type(input, "cats and dogs");
  expect(options()).toEqual(["Search for “cats and dogs”"]);
});

test("the top host is completed after the caret, and Backspace removes it", async () => {
  const { input } = await mount();
  await type(input, "gi");
  expect(input.value).toBe("github.com");
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 10]);
  await type(input, "gi", "deleteContentBackward");
  expect(input.value).toBe("gi");
});

test("Tab accepts the completion and Enter opens it", async () => {
  const { input, opened } = await mount();
  await type(input, "local");
  expect(input.value).toBe("localhost:3000");
  await press(input, "Tab");
  expect(input.value).toBe("localhost:3000");
  await press(input, "Enter");
  expect(opened).toEqual(["localhost:3000"]);
  expect(input.value).toBe("https://current.example/");
});

test("arrow keys move the selection and Enter opens the selected row", async () => {
  const { input, opened, selected } = await mount();
  await type(input, "g");
  await press(input, "ArrowDown");
  await press(input, "ArrowDown");
  expect(document.querySelector('[aria-selected="true"]')?.textContent).toContain("Gmail");
  await press(input, "Enter");
  expect(selected).toEqual([1]);
  await type(input, "g");
  await press(input, "ArrowDown");
  await press(input, "Enter");
  expect(opened).toEqual(["https://github.com/telar"]);
});

test("Escape closes the list, then restores the page's URL", async () => {
  const { input, opened } = await mount();
  await type(input, "something");
  await press(input, "Escape");
  expect(options()).toEqual([]);
  expect(input.value).toBe("something");
  await press(input, "Escape");
  expect(input.value).toBe("https://current.example/");
  expect(opened).toEqual([]);
});
