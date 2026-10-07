import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount, press } from "@/test/dom";
import type { PanelTab, PanelTabItem } from "../model";
import { RightPanel } from "./right-panel";

installTestDom();

async function panel({ tabs = [], browserUnavailable }: { tabs?: PanelTabItem[]; browserUnavailable?: string } = {}) {
  const opened: string[] = [];
  const view = await mount(
    <RightPanel
      sessionId="session_a"
      projectId="project_a"
      tabs={tabs}
      {...(tabs[0] ? { tab: tabs[0].id } : {})}
      onTabChange={() => {}}
      onOpenTab={(tab: PanelTab) => opened.push(tab)}
      onOpenNewTab={(tab: PanelTab) => opened.push(`new ${tab}`)}
      onOpenBrowser={() => opened.push("browser")}
      {...(browserUnavailable ? { browserUnavailable } : {})}
      onCloseTab={() => {}}
      onClose={() => {}}
    />,
  );
  return { ...view, opened };
}

const rowsIn = (root: ParentNode) => [...root.querySelectorAll('[role="group"][aria-label="Surfaces"] button')] as HTMLElement[];

async function key(letter: string, target: EventTarget = document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: letter, bubbles: true, cancelable: true }));
  });
}

describe("the empty panel's launcher", () => {
  test("is one short row per surface with its letter, the Browser first and no descriptions", async () => {
    const { host } = await panel();
    const rows = rowsIn(host).map((row) => row.textContent);
    expect(rows.slice(0, 5)).toEqual(["Browserb", "Terminalt", "Editore", "Diffd", "Simulators"]);
    expect(host.textContent).not.toContain("What this session changed");
  });

  test("a letter opens its surface, and b goes through the browser's one entry", async () => {
    const { opened } = await panel();
    await key("t");
    await key("D");
    await key("b");
    expect(opened).toEqual(["terminal", "diff", "browser"]);
  });

  test("a letter typed into a text field is text, not a shortcut", async () => {
    const { host, opened } = await panel();
    const field = document.createElement("textarea");
    host.appendChild(field);
    await key("t", field);
    expect(opened).toEqual([]);
  });

  test("an unavailable row is dimmed with its reason and opens nothing", async () => {
    const { host, opened } = await panel({ browserUnavailable: "Starting a browser needs the desktop app" });
    const browser = rowsIn(host)[0]!;
    expect(browser.getAttribute("title")).toBe("Starting a browser needs the desktop app");
    expect(browser.getAttribute("aria-disabled")).toBe("true");
    await act(async () => browser.click());
    await key("b");
    expect(opened).toEqual([]);
  });
});

describe("the + menu is the same launcher", () => {
  test("it lists the same rows and a letter opens one while it shows", async () => {
    const { host, opened } = await panel({ tabs: [{ id: "diff", kind: "diff", params: {} } as PanelTabItem] });
    await key("t");
    expect(opened).toEqual([]);
    await press(host.querySelector('[aria-label="Open a surface"]')!);
    const menu = document.querySelector('[role="menu"]')!;
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent).slice(0, 4)).toEqual(["Browserb", "Terminalt", "Editore", "New Diffd"]);
    await key("e", menu);
    expect(opened).toEqual(["editor"]);
  });
});
