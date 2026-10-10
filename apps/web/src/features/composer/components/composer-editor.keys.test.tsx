import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ComposerEditor } = await import("./composer-editor");
const { PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES } = await import("../editor-keys");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** A caret at a draft offset, counting each <br> as a newline. */
function placeAt(box: HTMLElement, offset: number) {
  let remaining = offset;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue!.length;
      if (remaining <= length) return window.getSelection()!.collapse(node, remaining);
      remaining -= length;
    } else if ((node as Element).tagName === "BR") remaining -= 1;
  }
}

/** The caret is marked with `|` in `initial`. */
async function editor(initial: string, onPasteLargeText?: (text: string) => void) {
  const caret = initial.indexOf("|");
  const value = initial.replace("|", "");
  const changes: string[] = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ComposerEditor value={value} onChange={(text) => changes.push(text)} {...(onPasteLargeText ? { onPasteLargeText } : {})} />);
  });
  const box = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  box.focus();
  placeAt(box, caret);
  const text = () => changes.at(-1) ?? value;
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      box.dispatchEvent(event);
    });
    return event;
  };
  const paste = (pasted: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => pasted } });
    act(() => {
      box.dispatchEvent(event);
    });
  };
  return { text, press, paste };
}

const shiftEnter = { key: "Enter", shiftKey: true };

describe("Shift+Enter in a list", () => {
  test.each([
    ["- milk|", "- milk\n- "],
    ["* milk|", "* milk\n* "],
    ["1. milk|", "1. milk\n2. "],
    ["- [x] milk|", "- [x] milk\n- [ ] "],
    ["  - nested|", "  - nested\n  - "],
  ])("%p continues with the next marker", async (initial, expected) => {
    const box = await editor(initial);
    box.press(shiftEnter);
    expect(box.text()).toBe(expected);
  });

  test("on an empty item ends the list", async () => {
    const box = await editor("- milk\n- |");
    box.press(shiftEnter);
    expect(box.text()).toBe("- milk\n");
  });
});

describe("Tab on a list item", () => {
  test("indents it, and Shift+Tab outdents it", async () => {
    const box = await editor("- a\n- b|");
    expect(box.press({ key: "Tab" }).defaultPrevented).toBe(true);
    expect(box.text()).toBe("- a\n  - b");
    box.press({ key: "Tab", shiftKey: true });
    expect(box.text()).toBe("- a\n- b");
  });

  test("outside a list keeps its usual meaning", async () => {
    const box = await editor("plain|");
    expect(box.press({ key: "Tab" }).defaultPrevented).toBe(false);
    expect(box.text()).toBe("plain");
  });
});

test("Shift+Enter inside a fenced code block keeps the line's indentation", async () => {
  const box = await editor("```\nif (x) {\n    run()|");
  box.press(shiftEnter);
  expect(box.text()).toBe("```\nif (x) {\n    run()\n    ");
});

describe("a paste", () => {
  test("at the threshold goes to the parent instead of the box", async () => {
    const pasted: string[] = [];
    const box = await editor("|", (text) => pasted.push(text));
    const large = "x".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES);
    box.paste(large);
    expect(pasted).toEqual([large]);
    expect(box.text()).toBe("");
  });

  test("below the threshold lands in the box", async () => {
    const pasted: string[] = [];
    const box = await editor("|", (text) => pasted.push(text));
    box.paste("x".repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES - 1));
    expect(pasted).toEqual([]);
    expect(box.text().length).toBe(PASTED_TEXT_ATTACHMENT_THRESHOLD_BYTES - 1);
  });
});
