import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BrowserUi } from "../hooks/use-browser-session";
import { CompactBar } from "./compact-bar";

GlobalRegistrator.register({ url: "http://localhost/surface/browser" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
const originalClose = window.close;

async function mount() {
  const actions: Record<string, unknown>[] = [];
  const b = {
    activeTab: { index: 0, id: "tab_1", title: "Example", url: "https://example.com/", active: true, loading: false, canGoBack: true, canGoForward: false },
    activeOrigin: "https://example.com",
    act: async (action: Record<string, unknown>) => {
      actions.push(action);
    },
  } as unknown as BrowserUi;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<CompactBar b={b} />);
  });
  const click = async (label: string) => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
    });
  };
  return { actions, click, host };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.close = originalClose;
});

afterAll(() => {
  void GlobalRegistrator.unregister();
});

describe("the picture-in-picture strip", () => {
  test("names the site and drives the page", async () => {
    const { actions, click, host } = await mount();
    expect(host.textContent).toContain("example.com");
    await click("Go back");
    await click("Reload");
    await click("Turn off on top");
    expect(actions).toEqual([{ action: "back" }, { action: "reload" }, { action: "float", on: false }]);
  });

  test("return puts the page back in the panel and focuses the cockpit", async () => {
    const { actions, click } = await mount();
    await click("Return to the panel");
    expect(actions).toEqual([{ action: "bring-back", focus: true }]);
  });

  test("close and Esc close the window, never the page", async () => {
    const close = mock(() => {});
    window.close = close;
    const { actions, click } = await mount();
    await click("Close picture in picture");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(close).toHaveBeenCalledTimes(2);
    expect(actions).toEqual([]);
  });
});
