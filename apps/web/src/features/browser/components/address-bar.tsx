"use client";

import { useLayoutEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { AppWindowIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { useNativeViewOverlay, useOverlayElementRef, useOverlayElements } from "@/platform/desktop/native-view-overlay";
import { cn } from "@/ui/utils";
import { displayUrl, inlineCompletion, rankSuggestions, type AddressSuggestion } from "../address-suggestions";
import { addressValue } from "../model";
import type { BrowserHistoryEntry, DesktopBrowserTab } from "../types";
import { Favicon } from "./favicon";

type Props = {
  url: string | undefined;
  tabs: readonly DesktopBrowserTab[];
  inputRef: RefObject<HTMLInputElement | null>;
  loadHistory: () => Promise<BrowserHistoryEntry[]>;
  onOpen: (text: string) => void;
  onSelectTab: (index: number) => void;
  onTyping: () => void;
};

const ICON = "size-3.5 shrink-0 text-muted-foreground";

function Row({ row }: { row: AddressSuggestion }) {
  if (row.kind === "typed") {
    return (
      <>
        {row.search ? <SearchIcon className={ICON} /> : <GlobeIcon className={ICON} />}
        <span className="min-w-0 truncate">{row.search ? `Search for “${row.text}”` : row.text}</span>
      </>
    );
  }
  return (
    <>
      <Favicon src={row.favicon} className="size-3.5" fallback={row.kind === "tab" ? <AppWindowIcon className={ICON} /> : <GlobeIcon className={ICON} />} />
      <span className="min-w-0 truncate">{row.title || displayUrl(row.url)}</span>
      {row.title ? <span className="min-w-0 shrink-[2] truncate font-mono text-muted-foreground">{displayUrl(row.url)}</span> : null}
      {row.kind === "tab" ? <span className="ml-auto shrink-0 text-muted-foreground">Switch to tab</span> : null}
    </>
  );
}

export function AddressBar({ url, tabs, inputRef, loadHistory, onOpen, onSelectTab, onTyping }: Props) {
  const [typed, setTyped] = useState<string>();
  const [completion, setCompletion] = useState("");
  const [rows, setRows] = useState<AddressSuggestion[]>([]);
  const [selected, setSelected] = useState(-1);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<readonly BrowserHistoryEntry[]>([]);
  const elements = useOverlayElements();
  const listRef = useOverlayElementRef(elements);
  const listOpen = open && typed !== undefined && rows.length > 0;
  useNativeViewOverlay(listOpen, elements);

  useLayoutEffect(() => {
    if (typed !== undefined && completion) inputRef.current?.setSelectionRange(typed.length, typed.length + completion.length);
  }, [inputRef, typed, completion]);

  const suggest = (text: string, complete: boolean) => {
    const next = rankSuggestions(text, { history, tabs, now: Date.now() });
    setTyped(text);
    setRows(next);
    setSelected(-1);
    setOpen(true);
    setCompletion(complete ? inlineCompletion(text, next) : "");
  };
  const reset = () => {
    setTyped(undefined);
    setCompletion("");
    setOpen(false);
  };
  const choose = (row: AddressSuggestion) => {
    reset();
    if (row.kind === "tab" && row.index !== undefined) onSelectTab(row.index);
    else onOpen(row.kind === "typed" ? row.text : row.url);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && rows.length > 0 && typed !== undefined) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setSelected((current) => ((current + 1 + step + rows.length + 1) % (rows.length + 1)) - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = listOpen ? rows[selected] : undefined;
      const text = `${typed ?? addressValue(url)}${completion}`.trim();
      if (row) choose(row);
      else if (text) choose({ kind: "typed", text, search: false });
    } else if (event.key === "Escape" && typed !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      if (listOpen || completion) {
        setOpen(false);
        setCompletion("");
      } else {
        reset();
        requestAnimationFrame(() => inputRef.current?.select());
      }
    } else if (event.key === "Tab" && !event.shiftKey && completion && typed !== undefined) {
      event.preventDefault();
      suggest(typed + completion, false);
    }
  };

  const active = listOpen && selected >= 0 ? `address-suggestion-${selected}` : undefined;
  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Address"
        aria-autocomplete="both"
        aria-expanded={listOpen}
        aria-controls={listOpen ? "address-suggestions" : undefined}
        aria-activedescendant={active}
        placeholder="Type an address"
        spellCheck={false}
        autoComplete="off"
        className="h-6 w-full rounded-md border border-transparent bg-muted/60 px-2 font-mono text-2xs outline-none focus:border-ring"
        value={typed === undefined ? addressValue(url) : typed + completion}
        onFocus={() => void loadHistory().then(setHistory, () => undefined)}
        onChange={(event) => {
          const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
          suggest(event.target.value, !inputType.startsWith("delete"));
          onTyping();
        }}
        onKeyDown={onKeyDown}
        onBlur={reset}
      />
      {listOpen ? (
        <div
          ref={listRef}
          id="address-suggestions"
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover p-1 text-2xs shadow-md"
        >
          {rows.map((row, index) => (
            <div
              key={row.kind === "typed" ? "typed" : `${row.kind}:${row.url}`}
              id={`address-suggestion-${index}`}
              role="option"
              aria-selected={index === selected}
              className={cn("flex cursor-default items-center gap-2 rounded px-2 py-1", index === selected ? "bg-accent text-foreground" : "hover:bg-accent/60")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(row)}
            >
              <Row row={row} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
