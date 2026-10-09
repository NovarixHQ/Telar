import { describe, expect, test } from "bun:test";
import { installTestDom, mount } from "@/test/dom";
import { MessageResponse } from "@/ui/message";

installTestDom();

const REPLY = [
  "Run **the build** with [the guide](https://example.com/guide) and `bun test`.",
  "",
  "- first *step*",
  "- second step",
  "",
  "```ts",
  "const a = 1;",
  "const b = 2;",
  "```",
  "",
  "Done.",
].join("\n");

const render = async (markdown: string) => (await mount(<MessageResponse>{markdown}</MessageResponse>)).host;

function textNode(host: Element, includes: string): Text {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.includes(includes)) return node as Text;
  }
  throw new Error(`no text node with "${includes}"`);
}

function copy(host: Element, from: [Text, number], to: [Text, number]): { text: string | undefined; defaulted: boolean } {
  const range = document.createRange();
  range.setStart(...from);
  range.setEnd(...to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const data = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "" } });
  from[0].parentElement!.dispatchEvent(event);
  return { text: data.get("text/plain"), defaulted: !event.defaultPrevented };
}

describe("copying a selection from a rendered reply", () => {
  test("puts the Markdown source of a selection spanning formatting on the clipboard", async () => {
    const host = await render(REPLY);
    const start = textNode(host, "Run ");
    const end = textNode(host, "Done.");
    const { text } = copy(host, [start, 0], [end, 5]);
    expect(text).toBe(
      [
        "Run **the build** with [the guide](https://example.com/guide) and `bun test`.",
        "",
        "- first *step*",
        "- second step",
        "",
        "```ts",
        "const a = 1;",
        "const b = 2;",
        "```",
        "",
        "Done.",
      ].join("\n"),
    );
  });

  test("leaves a selection inside one code block to the browser", async () => {
    const host = await render(REPLY);
    const line = textNode(host, "const a");
    expect(copy(host, [line, 0], [line, 5]).defaulted).toBe(true);
  });
});
