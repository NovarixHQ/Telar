import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
        <RightPanel sessionId="s1" projectId="p1" tabs={state.tabs as PanelTabItem[]} {...(state.activeTab ? { tab: state.activeTab } : {})} open onTabChange={(id) => setState((current) => ({ ...current, activeTab: id }))} onOpenTab={() => {}} onCloseTab={(id) => setState((current) => closePanelTab(current, id))} />
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

describe("the strip follows the tab in front", () => {
  test("choosing a tab scrolls it into view, and only it", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      function Strip() {
        const [tab, setTab] = useState("diff");
        return (
          <SidebarProvider storageKey="tab-strip-test">
            <RightPanel sessionId="s1" projectId="p1" tabs={TABS} tab={tab} open onTabChange={setTab} onOpenTab={() => {}} onCloseTab={() => {}} />
          </SidebarProvider>
        );
      }
      const { host } = await mount(<Strip />);
      const tabNamed = (id: string) => host.querySelector(`[role="tab"][aria-controls="right-panel-${id}"]`)!;
      expect(scrolled.some((node) => node.contains(tabNamed("diff")))).toBe(true);
      scrolled.length = 0;
      await click(tabNamed("file:docs/notes.md"));
      expect(scrolled.length).toBe(1);
      expect(scrolled[0]!.contains(tabNamed("file:docs/notes.md"))).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("the strip's scroll buttons", () => {
  async function stripSized(content: number, box: number) {
    const { host } = await mount(
      <SidebarProvider storageKey="tab-strip-test">
        <RightPanel sessionId="s1" projectId="p1" tabs={TABS} tab="diff" open onTabChange={() => {}} onOpenTab={() => {}} onCloseTab={() => {}} />
      </SidebarProvider>,
    );
    const viewport = host.querySelector<HTMLElement>('[role="tablist"]')!;
    const size = { scrollWidth: content, clientWidth: box, scrollHeight: 28, clientHeight: 28 };
    for (const [key, value] of Object.entries(size)) Object.defineProperty(viewport, key, { configurable: true, value });
    await act(async () => void viewport.dispatchEvent(new Event("scroll")));
    const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    return { viewport, button };
  }

  test("a strip that fits shows none", async () => {
    const { button } = await stripSized(300, 300);
    expect(button("Scroll tabs left")).toBeNull();
    expect(button("Scroll tabs right")).toBeNull();
  });

  test("an overflowing strip scrolls one tab per press, and each button stops at its end", async () => {
    const { viewport, button } = await stripSized(300, 150);
    expect(button("Scroll tabs left")!.disabled).toBe(true);
    expect(button("Scroll tabs right")!.disabled).toBe(false);
    await click(button("Scroll tabs right")!);
    expect(viewport.scrollLeft).toBe(100);
    expect(button("Scroll tabs left")!.disabled).toBe(false);
    await click(button("Scroll tabs right")!);
    expect(viewport.scrollLeft).toBe(150);
    expect(button("Scroll tabs right")!.disabled).toBe(true);
    await click(button("Scroll tabs left")!);
    expect(viewport.scrollLeft).toBe(50);
  });
});

describe("a page tab's icon", () => {
  const PAGE_TABS = [{ id: "browser:a", kind: "browser:a", params: {} }, TABS[1]!] as PanelTabItem[];
  const page = (favicon: string | null, url = "https://a.test/") => ({ id: "a", index: 0, active: true, title: "A", url, favicon, loading: false, canGoBack: false, canGoForward: false });

  async function stripWithPage(favicon: string | null) {
    let push: (state: unknown) => void = () => {};
    (window as { telarDesktop?: unknown }).telarDesktop = {
      browser: {
        getState: async () => ({ scopeKey: "s1", tabs: [page(favicon)] }),
        onState: (listener: (state: unknown) => void) => ((push = listener), () => {}),
        setVisible: async () => {},
      },
    };
    const { host } = await mount(
      <SidebarProvider storageKey="tab-strip-test">
        <RightPanel sessionId="s1" projectId="p1" tabs={PAGE_TABS} tab="diff" open onTabChange={() => {}} onOpenTab={() => {}} onCloseTab={() => {}} />
      </SidebarProvider>,
    );
    const chip = () => host.querySelector('[role="tab"][aria-controls="right-panel-browser:a"]')!;
    await flush(() => chip().textContent === "A");
    return { chip, push: (state: unknown) => act(async () => push({ scopeKey: "s1", tabs: [state] })) };
  }

  afterEach(() => {
    delete (window as { telarDesktop?: unknown }).telarDesktop;
  });

  test("shows the page's favicon, and follows it when the page moves on", async () => {
    const { chip, push } = await stripWithPage("https://a.test/favicon.ico");
    expect(chip().querySelector("img")?.getAttribute("src")).toBe("https://a.test/favicon.ico");
    await push(page("https://b.test/icon.png", "https://b.test/"));
    expect(chip().querySelector("img")?.getAttribute("src")).toBe("https://b.test/icon.png");
    await push(page(null, "https://c.test/"));
    expect(chip().querySelector("img")).toBeNull();
    expect(chip().querySelector("svg")).not.toBeNull();
  });

  test("a page with no favicon, or one that fails to load, keeps the globe", async () => {
    const { chip, push } = await stripWithPage(null);
    expect(chip().querySelector("img")).toBeNull();
    expect(chip().querySelector("svg")).not.toBeNull();
    await push(page("https://a.test/missing.ico"));
    await act(async () => void chip().querySelector("img")!.dispatchEvent(new Event("error")));
    expect(chip().querySelector("img")).toBeNull();
    expect(chip().querySelector("svg")).not.toBeNull();
  });
});
