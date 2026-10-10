import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ComposerEditor } = await import("./composer-editor");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function editor(value = "") {
  const changes: string[] = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ComposerEditor value={value} onChange={(text) => changes.push(text)} />);
  });
  const box = host.querySelector<HTMLElement>("[data-slot=composer-editor]")!;
  box.focus();
  const end = document.createRange();
  end.selectNodeContents(box);
  end.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(end);

  /** What the browser does for a keystroke: text into the node under the caret, then `input`. */
  const type = (text: string) => {
    for (const char of text) {
      const range = window.getSelection()!.getRangeAt(0);
      let node = range.startContainer;
      let offset = range.startOffset;
      if (node.nodeType !== Node.TEXT_NODE) {
        const text = document.createTextNode("");
        node.insertBefore(text, node.childNodes[offset] ?? null);
        node = text;
        offset = 0;
      }
      node.nodeValue = node.nodeValue!.slice(0, offset) + char + node.nodeValue!.slice(offset);
      window.getSelection()!.collapse(node, offset + 1);
      act(() => {
        box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
      });
    }
  };
  const press = (init: KeyboardEventInit) =>
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });
  const paste = (pasted: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [], getData: () => pasted } });
    act(() => {
      box.dispatchEvent(event);
    });
  };
  const styled = () => [...box.querySelectorAll<HTMLElement>("[data-md]")].map((span) => [span.textContent, span.dataset.md]);
  return { box, type, press, paste, styled, text: () => changes.at(-1) ?? value };
}

describe("typing Markdown", () => {
  test.each([
    ["**bold**", "strong"],
    ["__bold__", "strong"],
    ["*it*", "em"],
    ["_it_", "em"],
    ["~~gone~~", "strike"],
    ["`code`", "code"],
  ])("%p styles as it is typed and sends the raw text", async (markdown, style) => {
    const box = await editor();
    box.type(`a ${markdown} b`);
    expect(box.text()).toBe(`a ${markdown} b`);
    expect(box.styled().filter(([, md]) => md === style)).toHaveLength(1);
    expect(box.styled().filter(([, md]) => md === "mark")).toHaveLength(2);
    expect(box.box.lastChild?.textContent).toBe(" b");
  });

  test("a link styles its text", async () => {
    const box = await editor();
    box.type("[docs](https://x.dev)");
    expect(box.styled()).toEqual([
      ["[", "mark"],
      ["docs", "link"],
      ["](https://x.dev)", "mark"],
    ]);
  });

  test.each([
    ["# Title", "h1"],
    ["## Title", "h2"],
    ["### Title", "h3"],
    ["> Title", "quote"],
  ])("%p styles its line", async (markdown, style) => {
    const box = await editor();
    box.type(markdown);
    expect(box.styled().at(-1)).toEqual(["Title", style]);
  });

  test.each(["my_file_name.ts", "2*3*4", "snake_case and more_snake"])("%p stays plain", async (plain) => {
    const box = await editor();
    box.type(plain);
    expect(box.styled()).toEqual([]);
    expect(box.text()).toBe(plain);
  });

  test("a typed URL or path stays text rather than becoming a chip under the caret", async () => {
    const box = await editor();
    box.type("open https://x.dev and `src/a.ts`");
    expect(box.box.querySelector("[data-chip-text]")).toBeNull();
    expect(box.text()).toBe("open https://x.dev and `src/a.ts`");
  });
});

describe("a draft with Markdown", () => {
  test("lists, fences and rules style by line, with no formatting inside the fence", async () => {
    const box = await editor("- **milk**\n1. eggs\n```\nx = **y**\n```\n---");
    expect(box.styled()).toEqual([
      ["- **", "mark"],
      ["milk", "strong"],
      ["**", "mark"],
      ["1. ", "mark"],
      ["```", "mark codeBlock"],
      ["x = **y**", "codeBlock"],
      ["```", "mark codeBlock"],
      ["---", "mark rule"],
    ]);
  });

  test("a chip inside bold text stays a chip and sends its own text", async () => {
    const box = await editor("**see `src/a.ts` now**");
    expect(box.box.querySelector("[data-chip-text]")?.getAttribute("data-chip-text")).toBe("`src/a.ts`");
    expect(box.styled()).toEqual([
      ["**", "mark"],
      ["see ", "strong"],
      [" now", "strong"],
      ["**", "mark"],
    ]);
    box.type("!");
    expect(box.text()).toBe("**see `src/a.ts` now**!");
  });

  test("a paste lands as plain text and styles like typing", async () => {
    const box = await editor();
    box.paste("**pasted**");
    expect(box.text()).toBe("**pasted**");
    expect(box.styled()).toContainEqual(["pasted", "strong"]);
  });
});

describe("undo", () => {
  test("⌘Z undoes a burst of typing, ⌘⇧Z redoes it, across restyles", async () => {
    const box = await editor("start ");
    box.type("**bold**");
    box.press({ key: "z", metaKey: true });
    expect(box.text()).toBe("start ");
    expect(box.styled()).toEqual([]);
    box.press({ key: "z", metaKey: true, shiftKey: true });
    expect(box.text()).toBe("start **bold**");
    expect(box.styled()).toContainEqual(["bold", "strong"]);
  });

  test("the app menu's Undo goes through the same history", async () => {
    const box = await editor();
    box.type("abc");
    act(() => {
      box.box.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" }));
    });
    expect(box.text()).toBe("");
  });
});
