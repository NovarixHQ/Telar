"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QuoteIcon } from "lucide-react";
import { quoteReference } from "@telar/client/composer";
import { Button } from "@/ui/button";
import { selectionMarkdown } from "@/ui/markdown-clipboard";

type Selected = { itemId: string; markdown: string; x: number; y: number };

function selected(): Selected | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined;
  const range = selection.getRangeAt(0);
  const at = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-quote-source]");
  const source = at(range.startContainer);
  if (!source || source !== at(range.endContainer)) return undefined;
  const markdown = selectionMarkdown(selection) ?? selection.toString().trim();
  if (!markdown) return undefined;
  const rect = range.getBoundingClientRect();
  return { itemId: source.dataset.quoteSource!, markdown, x: rect.left + rect.width / 2, y: rect.top };
}

/** A "Quote" button over text selected inside one reply; it puts the selection in the composer as a quote chip. */
export function SelectionQuote({ onInsert }: { onInsert: (text: string) => void }) {
  const [selection, setSelection] = useState<Selected>();
  useEffect(() => {
    const update = () => setSelection(selected());
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);
  if (!selection) return null;
  return createPortal(
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="fixed z-50 -translate-x-1/2 -translate-y-full shadow-md"
      style={{ left: Math.max(8, selection.x), top: Math.max(8, selection.y - 6) }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        onInsert(quoteReference(selection.markdown, selection.itemId).text);
        window.getSelection()?.removeAllRanges();
        setSelection(undefined);
      }}
    >
      <QuoteIcon aria-hidden className="size-3.5" />
      Quote
    </Button>,
    document.body,
  );
}
