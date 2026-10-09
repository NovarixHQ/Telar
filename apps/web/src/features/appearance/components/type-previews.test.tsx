import { afterAll, afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodePreviews, InterfacePreview } from "./type-previews";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom keeps an element's computed style until that element itself mutates, so a root change would read stale.
const computed = window.getComputedStyle.bind(window);
globalThis.getComputedStyle = window.getComputedStyle = (element, pseudo) => {
  element.toggleAttribute("data-restyle");
  element.toggleAttribute("data-restyle");
  return computed(element, pseudo);
};

const GLOBALS = fs.readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
// happy-dom does not inherit custom properties, so the fixture declares them on every element.
const TERMINAL_LOOK = `
  * { --card: #fafafa; --foreground: #111111; --primary: #3355ff; --app-font-mono-size: 12px; }
  html.dark * { --card: #101010; --foreground: #eeeeee; }
  html[data-big] * { --app-font-mono-size: 18px; }
`;

const roots: Root[] = [];
const root = document.documentElement;

afterEach(async () => {
  await act(async () => {
    for (const mounted of roots.splice(0)) mounted.unmount();
  });
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  for (const name of root.getAttributeNames()) root.removeAttribute(name);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function stylesheet(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const mounted = createRoot(host);
  roots.push(mounted);
  await act(async () => mounted.render(node));
  await settle();
  return host;
}

describe("the code preview is the real diff viewer", () => {
  test("its face and line colours follow the code font and the scheme", async () => {
    stylesheet(GLOBALS);
    stylesheet(":root { --font-geist-mono: Geist Mono; --font-jetbrains: JetBrains Mono; }");
    const host = await mount(<CodePreviews />);
    const diff = host.querySelector("diffs-container")!;
    const read = (property: string) => getComputedStyle(diff).getPropertyValue(property);
    const before = { font: read("--diffs-font-family"), addition: read("--diffs-bg-addition-override") };
    expect(before.font).toStartWith("Geist Mono");

    await act(async () => root.setAttribute("data-font-mono", "jetbrains"));
    expect(read("--diffs-font-family")).toStartWith("JetBrains Mono");

    await act(async () => root.classList.add("dark"));
    expect(read("--diffs-bg-addition-override")).not.toBe(before.addition);
  });
});

describe("the terminal preview is a read-only xterm in the terminal's own look", () => {
  test("it draws the sample with the terminal's background and font", async () => {
    stylesheet(TERMINAL_LOOK);
    const host = await mount(<CodePreviews />);
    expect(host.querySelector(".xterm-rows")?.textContent).toContain("1061 passed");
    expect(getComputedStyle(host.querySelector(".xterm-scrollable-element")!).backgroundColor).toBe("#fafafa");
    expect(getComputedStyle(host.querySelector(".xterm-rows")!).fontSize).toBe("12px");
  });

  test("switching the scheme or the code size redraws it", async () => {
    stylesheet(TERMINAL_LOOK);
    const host = await mount(<CodePreviews />);

    await act(async () => root.classList.add("dark"));
    await settle();
    expect(getComputedStyle(host.querySelector(".xterm-scrollable-element")!).backgroundColor).toBe("#101010");

    await act(async () => root.setAttribute("data-big", ""));
    await settle();
    expect(getComputedStyle(host.querySelector(".xterm-rows")!).fontSize).toBe("18px");
  });
});

describe("the interface preview is a real user message", () => {
  test("the skill and file references draw as the transcript's chips", async () => {
    const host = await mount(<InterfacePreview />);
    const chips = [...host.querySelectorAll("[title]")].map((chip) => chip.textContent);
    expect(chips).toEqual(["designer", "studio-draft.test.ts", "panel.tsx"]);
    expect(host.querySelector("button")).toBeNull();
  });
});
