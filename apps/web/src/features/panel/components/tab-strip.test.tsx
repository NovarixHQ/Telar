import { beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { filePanelTab, type PanelTabItem } from "../model";
import { closePanelTab, type PanelTabState } from "../tabs";
import { installTestDom, mount, flush, click, press, stubFetch } from "@/test/dom";
import { SidebarProvider } from "@/ui/sidebar";
import { RightPanel } from "./right-panel";

installTestDom();

let copied: string[] = [];
let closed: string[] = [];
beforeEach(() => {
  copied = [];
  closed = [];
  stubFetch({});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
});

const TABS = [
  { id: "editor", kind: "editor", params: { path: "src/app.ts" } },
  { id: "diff", kind: "diff", params: {} },
  { id: filePanelTab("docs/notes.md"), kind: filePanelTab("docs/notes.md"), params: {} },
] as PanelTabItem[];

async function openMenu(tabs: PanelTabItem[], index: number) {
  const { host } = await mount(
    <SidebarProvider storageKey="tab-strip-test">
      <RightPanel sessionId="s1" projectId="p1" tabs={tabs} tab="diff" open onTabChange={() => {}} onOpenTab={() => {}} onCloseTab={(id) => void closed.push(id)} />
    </SidebarProvider>,
  );
  const chip = host.querySelectorAll('[role="tab"]')[index]!;
  await act(async () => void chip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 2 })));
  await flush();
}

const rows = () => [...document.querySelectorAll('[role="menuitem"]')];
const labels = () => rows().map((row) => row.textContent?.trim());
const row = (label: string) => rows().find((each) => each.textContent?.trim() === label)!;
const disabled = (label: string) => row(label).hasAttribute("data-disabled");

describe("a tab's close button", () => {
  function Strip() {
    const [state, setState] = useState<PanelTabState<string>>({ tabs: [...TABS], activeTab: "diff", open: true });
    return (
      <SidebarProvider storageKey="tab-strip-test">
        <RightPanel sessionId="s1" projectId="p1" tabs={state.tabs as PanelTabItem[]} {...(state.activeTab ? { tab: state.activeTab } : {})} open onTabChange={(id) => setState((current) => ({ ...current, activeTab: id }))} onOpenTab={() => {}} onCloseTab={(id) => setState((current) => closePanelTab(current, id))} onClose={() => {}} />
      </SidebarProvider>
    );
  }
  const strip = (host: HTMLElement) => [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("aria-controls"));

  test("one press closes a tab that is not in front, and the front tab stays", async () => {
    const { host } = await mount(<Strip />);
    await press(host.querySelector('[aria-label^="Close"]')!);
    expect(strip(host)).toEqual(["right-panel-diff", "right-panel-file:docs/notes.md"]);
    expect(host.querySelector('[aria-selected="true"]')?.getAttribute("aria-controls")).toBe("right-panel-diff");
  });

  test("one press closes the tab in front", async () => {
    const { host } = await mount(<Strip />);
    await press(host.querySelectorAll('[aria-label^="Close"]')[1]!);
    expect(strip(host)).toEqual(["right-panel-editor", "right-panel-file:docs/notes.md"]);
  });
});

describe("the panel tab's menu", () => {
  test("a tab with a path offers Copy path, and copies it", async () => {
    await openMenu(TABS, 0);
    expect(labels()).toEqual(["Copy path", "Close", "Close others", "Close to the right", "Close all", "Fill the window"]);
    await click(row("Copy path"));
    expect(copied).toEqual(["src/app.ts"]);
  });

  test("a file tab copies the path it opened", async () => {
    await openMenu(TABS, 2);
    await click(row("Copy path"));
    expect(copied).toEqual(["docs/notes.md"]);
  });

  test("a surface tab has no Copy path", async () => {
    await openMenu(TABS, 1);
    expect(labels()).not.toContain("Copy path");
  });

  test("Close to the right closes only the tabs after this one", async () => {
    await openMenu(TABS, 0);
    await click(row("Close to the right"));
    expect(closed).toEqual(["diff", "file:docs/notes.md"]);
  });

  test("the last tab can't close to its right", async () => {
    await openMenu(TABS, 2);
    expect(disabled("Close to the right")).toBe(true);
    expect(disabled("Close others")).toBe(false);
  });

  test("a lone tab has nothing else to close", async () => {
    await openMenu([TABS[1]!], 0);
    expect(disabled("Close others")).toBe(true);
    expect(disabled("Close to the right")).toBe(true);
    expect(disabled("Close all")).toBe(false);
  });
});
