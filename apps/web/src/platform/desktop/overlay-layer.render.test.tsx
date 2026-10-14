import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/ui/context-menu";
import { flush, installTestDom, mount, press } from "@/test/dom";
import { nativeViewOverlayHidden } from "./native-view-overlay";
import { overlayRect, useOverlayLayerHost } from "./overlay-layer";

installTestDom();

type Rect = { x: number; y: number; width: number; height: number } | null;

const rects: Rect[] = [];
let outside: (() => void) | null = null;
let overlay: Document;

const measure = HTMLElement.prototype.getBoundingClientRect;
const openWindow = window.open;

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = measure;
  window.open = openWindow;
  delete (window as { telarDesktop?: unknown }).telarDesktop;
  document.querySelector("iframe")?.remove();
});

beforeEach(() => {
  rects.length = 0;
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const child = frame.contentWindow!;
  overlay = child.document;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.ownerDocument !== overlay || !this.querySelector('[role="menu"]')) return new DOMRect(0, 0, 0, 0);
    const [, x = "0", y = "0"] = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(overlay.querySelector<HTMLElement>("[data-overlay-layer]")?.parentElement?.style.transform ?? "") ?? [];
    return new DOMRect(100 + Number(x), 40 + Number(y), 160, 90);
  };
  window.open = (() => child) as typeof window.open;
  (window as { telarDesktop?: unknown }).telarDesktop = {
    overlay: {
      setRect: (rect: Rect) => rects.push(rect),
      onOutside: (listener: () => void) => {
        outside = listener;
        return () => (outside = null);
      },
    },
  };
});

function Cockpit({ withBrowser = true, dialog = false }: { withBrowser?: boolean; dialog?: boolean }) {
  return (
    <>
      {withBrowser ? <BrowserHost /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Reload</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog}>
        <DialogContent>
          <DialogTitle>Restart?</DialogTitle>
        </DialogContent>
      </Dialog>
      <p id="elsewhere">Rail</p>
    </>
  );
}

function BrowserHost() {
  useOverlayLayerHost();
  return null;
}

const trigger = () => [...document.querySelectorAll("button")].find((node) => node.textContent === "Options")!;
const menuIn = (doc: Document) => doc.querySelector('[role="menu"]');

async function openMenu() {
  await press(trigger());
  await flush(() => menuIn(overlay) !== null && rects.at(-1) != null);
}

describe("popups draw in the overlay layer while a native view is shown", () => {
  test("the menu renders in the overlay document and the page underneath is never frozen", async () => {
    await mount(<Cockpit />);
    await openMenu();
    expect(menuIn(overlay)?.textContent).toContain("Reload");
    expect(menuIn(document)).toBeNull();
    expect(nativeViewOverlayHidden()).toBe(false);
  });

  test("the layer covers the menu plus its shadow, and nothing once it closes", async () => {
    await mount(<Cockpit />);
    await openMenu();
    expect(rects.at(-1)).toEqual({ x: 92, y: 32, width: 176, height: 106 });
    await press(document.getElementById("elsewhere")!);
    await flush(() => rects.at(-1) === null);
    expect(rects.at(-1)).toBeNull();
    expect(menuIn(overlay)).toBeNull();
  });

  test("a press in the cockpit closes the menu, and a press on its trigger closes it once", async () => {
    await mount(<Cockpit />);
    await openMenu();
    await press(document.getElementById("elsewhere")!);
    await flush(() => menuIn(overlay) === null);
    expect(menuIn(overlay)).toBeNull();

    await openMenu();
    await press(trigger());
    await flush(() => menuIn(overlay) === null);
    expect(menuIn(overlay)).toBeNull();
  });

  test("a click on the page in another view closes the menu", async () => {
    await mount(<Cockpit />);
    await openMenu();
    await act(async () => outside?.());
    await flush(() => menuIn(overlay) === null);
    expect(menuIn(overlay)).toBeNull();
  });

  test("a right-click opens its menu in the overlay document", async () => {
    await mount(
      <>
        <BrowserHost />
        <ContextMenu>
          <ContextMenuTrigger>
            <span id="row">Row</span>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Rename</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </>,
    );
    await act(async () => {
      document.getElementById("row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 60 }));
    });
    await flush(() => menuIn(overlay) !== null);
    expect(menuIn(overlay)?.textContent).toContain("Rename");
    expect(menuIn(document)).toBeNull();
  });

  test("a chorded key typed in the overlay reaches the cockpit's shortcuts, and plain typing does not", async () => {
    await mount(<Cockpit />);
    await openMenu();
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => {
      heard.push(event.key);
      event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    const typed = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      overlay.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(typed({ key: "k", metaKey: true })).toBe(true);
    typed({ key: "j" });
    window.removeEventListener("keydown", listen);
    expect(heard).toEqual(["k"]);
  });

  test("a select opens in the overlay over its selected item, as it does in the cockpit", async () => {
    HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(200, 300, 160, 24);
    for (const html of [document.documentElement, overlay.documentElement]) {
      Object.defineProperty(html, "clientHeight", { configurable: true, value: 768 });
      Object.defineProperty(html, "clientWidth", { configurable: true, value: 1024 });
    }
    await mount(
      <>
        <BrowserHost />
        <Select defaultValue="b">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectItem value="b">Bravo</SelectItem>
          </SelectContent>
        </Select>
      </>,
    );
    await press(document.querySelector('[data-slot="select-trigger"]')!);
    const positioner = () => overlay.querySelector<HTMLElement>('[data-side]');
    await flush(() => positioner() !== null);
    expect(overlay.querySelector('[role="listbox"]')?.textContent).toContain("Bravo");
    expect(positioner()?.getAttribute("data-side")).toBe("none");
    for (const html of [document.documentElement, overlay.documentElement]) {
      delete (html as { clientHeight?: number }).clientHeight;
      delete (html as { clientWidth?: number }).clientWidth;
    }
  });

  test("dialogs keep freezing the page", async () => {
    const { unmount } = await mount(<Cockpit dialog />);
    await flush(() => nativeViewOverlayHidden());
    expect(nativeViewOverlayHidden()).toBe(true);
    unmount();
  });

  test("with no native view on screen, popups stay in the cockpit", async () => {
    await mount(<Cockpit withBrowser={false} />);
    await press(trigger());
    await flush(() => menuIn(document) !== null);
    expect(menuIn(document)).not.toBeNull();
    expect(menuIn(overlay)).toBeNull();
  });
});

describe("the overlay document looks like the cockpit", () => {
  test("it carries the cockpit's stylesheets and theme, and follows an Appearance change", async () => {
    const sheet = document.createElement("style");
    sheet.textContent = ".bg-popover{background:white}";
    document.head.append(sheet);
    document.documentElement.className = "light";
    await mount(<Cockpit />);
    await flush(() => overlay.documentElement.className === "light");
    expect([...overlay.querySelectorAll("style")].some((node) => node.textContent === sheet.textContent)).toBe(true);

    await act(async () => {
      document.documentElement.className = "dark";
      sheet.textContent = ".bg-popover{background:black}";
    });
    await flush(() => overlay.documentElement.className === "dark");
    expect(overlay.documentElement.className).toBe("dark");
    expect([...overlay.querySelectorAll("style")].some((node) => node.textContent === sheet.textContent)).toBe(true);
    sheet.remove();
  });
});

describe("overlayRect", () => {
  test("pads the popup for its shadow and keeps inside the window", () => {
    expect(overlayRect({ x: 2, y: 3, width: 100, height: 50 }, { x: 0, y: 0 }, { width: 1000, height: 800 })).toEqual({ x: 0, y: 0, width: 110, height: 61 });
    expect(overlayRect({ x: 0, y: 0, width: 100, height: 50 }, { x: 900, y: 760 }, { width: 1000, height: 800 })).toEqual({ x: 892, y: 752, width: 108, height: 48 });
    expect(overlayRect(null, { x: 0, y: 0 }, { width: 1000, height: 800 })).toBeNull();
  });
});
