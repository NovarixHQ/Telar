import { beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { fakeSessionsStream } from "@/test/sessions-stream";
import { flush, installTestDom, mount } from "@/test/dom";
import { EngineBrowserSurface } from "./engine-browser-surface";

installTestDom();

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
});

function engine(refusal?: { status: number; message: string }) {
  const stream = fakeSessionsStream();
  const inputs: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path.endsWith("/browser/stream")) return refusal ? Response.json({ error: { message: refusal.message } }, { status: refusal.status }) : stream.answer(init?.signal);
    if (path.endsWith("/browser/input")) {
      inputs.push(JSON.parse(String(init?.body)));
      return Response.json({});
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
  return { stream, inputs };
}

const tabs = { type: "tabs", tabs: [{ id: "T1", url: "https://a.test/", title: "Alpha", active: true }, { id: "T2", url: "https://b.test/", title: "Beta", active: false }] };
const frame = { type: "frame", tabId: "T1", data: "AAAA", width: 1000, height: 500 };

async function live() {
  const fake = engine();
  const { host } = await mount(<EngineBrowserSurface sessionId="session_a" />);
  await flush();
  fake.stream.announce(tabs as never);
  fake.stream.announce(frame as never);
  await flush(() => host.querySelector("img") !== null);
  return { ...fake, host };
}

test("the engine's tabs and the latest frame are drawn, and the address shows the active page", async () => {
  const { host } = await live();
  expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Alpha", "Beta"]);
  expect((host.querySelector('[aria-label="Address"]') as HTMLInputElement).value).toBe("https://a.test/");
  expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
});

test("a click on the frame is sent in page coordinates, in order", async () => {
  const { host, inputs } = await live();
  const image = host.querySelector("img")!;
  image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 500, height: 250 }) as DOMRect;
  const init = { bubbles: true, clientX: 260, clientY: 145, button: 0, detail: 1 };
  await act(async () => {
    image.dispatchEvent(new PointerEvent("pointerdown", init));
    image.dispatchEvent(new PointerEvent("pointerup", init));
  });
  await flush(() => inputs.length === 2);
  expect(inputs).toEqual([
    { type: "mouse", action: "down", x: 500, y: 250, button: "left", clickCount: 1, modifiers: 0 },
    { type: "mouse", action: "up", x: 500, y: 250, button: "left", clickCount: 1, modifiers: 0 },
  ]);
});

test("typing sends keys, and a submitted address navigates", async () => {
  const { host, inputs } = await live();
  const image = host.querySelector("img")!;
  await act(async () => {
    image.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "h", code: "KeyH", keyCode: 72 } as KeyboardEventInit));
  });
  await flush(() => inputs.length === 1);
  expect(inputs[0]).toMatchObject({ type: "key", action: "down", key: "h", text: "h" });

  const address = host.querySelector('[aria-label="Address"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(address, "example.com");
    address.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    address.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush(() => inputs.length === 2);
  expect(inputs[1]).toEqual({ type: "navigate", url: "https://example.com/" });
});

test("the tab strip and the toolbar send their commands", async () => {
  const { host, inputs } = await live();
  const click = async (label: string) => {
    await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLElement).click());
  };
  await act(async () => ([...host.querySelectorAll('[role="tab"]')][1] as HTMLElement).click());
  await click("New tab");
  await click("Back");
  await click("Reload");
  await click("Close Beta");
  await flush(() => inputs.length === 5);
  expect(inputs).toEqual([
    { type: "tab", action: "select", tabId: "T2" },
    { type: "tab", action: "new" },
    { type: "history", action: "back" },
    { type: "history", action: "reload" },
    { type: "tab", action: "close", tabId: "T2" },
  ]);
});

test("an engine that refuses the stream says why and is not asked again", async () => {
  engine({ status: 400, message: "This session's browser is in the desktop app." });
  const { host } = await mount(<EngineBrowserSurface sessionId="session_a" />);
  await flush(() => host.textContent?.includes("desktop app") === true);
  expect(host.textContent).toContain("This session's browser is in the desktop app.");
});
