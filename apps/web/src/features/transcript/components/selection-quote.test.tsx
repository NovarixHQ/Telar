import { describe, expect, test } from "bun:test";
import { act } from "react";
import { buttonLabelled, click, installTestDom, mount } from "@/test/dom";
import { segmentDraft } from "@/features/composer/tokens";
import { MessageResponse } from "@/ui/message";
import { SelectionQuote } from "./selection-quote";

installTestDom();

async function selectInReply(markdown: string, from: string, to: string) {
  const inserted: string[] = [];
  const { host } = await mount(
    <>
      <div data-quote-source="item_42">
        <MessageResponse>{markdown}</MessageResponse>
      </div>
      <p>Outside the reply</p>
      <SelectionQuote onInsert={(text) => inserted.push(text)} />
    </>,
  );
  const textOf = (needle: string) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.includes(needle)) return node;
    throw new Error(needle);
  };
  const start = textOf(from);
  const end = textOf(to);
  const range = document.createRange();
  range.setStart(start, start.textContent!.indexOf(from));
  range.setEnd(end, end.textContent!.indexOf(to) + to.length);
  await act(async () => {
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  return inserted;
}

describe("quoting a selection from a reply", () => {
  test("the Quote button puts the selection in the composer as a quote chip", async () => {
    const inserted = await selectInReply("Use **bun** here.\n\nThen ship it.", "Use", "ship it.");
    await click(buttonLabelled("Quote"));

    expect(inserted).toHaveLength(1);
    const segments = segmentDraft(`Why?\n\n${inserted[0]}\n`);
    const chip = segments.find((segment) => segment.type === "chip");
    expect(chip?.type === "chip" && chip.reference.kind).toBe("quote");
    expect(chip?.type === "chip" && chip.reference.label).toBe("Use bun here.");
    expect(inserted[0]).toBe("> Use **bun** here.\n>\n> Then ship it.\n> — [source](telar:item/item_42)");
    expect(buttonLabelled("Quote")).toBeUndefined();
  });

  test("a selection that leaves the reply offers no Quote button", async () => {
    await selectInReply("Use bun here.", "Use", "Outside");
    expect(buttonLabelled("Quote")).toBeUndefined();
  });
});
