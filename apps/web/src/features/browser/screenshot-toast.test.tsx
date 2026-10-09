import { describe, expect, test } from "bun:test";
import { act } from "react";
import { buttonLabelled, click, flush, installTestDom, mount } from "@/test/dom";
import { toastManager, Toaster } from "@/ui/toast";
import { showScreenshotFailure, showScreenshotToast } from "./screenshot-toast";
import type { DesktopBrowserBridge } from "./types";

installTestDom();

const PATH = "/shots/screenshot-example-com-abc.png";

async function saved(extra: Partial<DesktopBrowserBridge> = {}) {
  const calls: { copied: string[]; revealed: string[]; written: string[] } = { copied: [], revealed: [], written: [] };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void calls.written.push(text) } });
  const bridge = {
    copyScreenshot: async (path: string) => {
      calls.copied.push(path);
      return { ok: true };
    },
    revealFile: async (path: string) => {
      calls.revealed.push(path);
      return { ok: true };
    },
    ...extra,
  } as unknown as DesktopBrowserBridge;
  await mount(<Toaster />);
  await act(async () => void showScreenshotToast(bridge, PATH));
  await flush(() => document.body.textContent?.includes("Screenshot saved") ?? false);
  return calls;
}

describe("the screenshot toast", () => {
  test("says the screenshot was saved and offers the three actions", async () => {
    await saved();
    expect(document.body.textContent).toContain("Screenshot saved");
    expect(["Copy image", "Copy path", "Reveal in Finder"].map((label) => Boolean(buttonLabelled(label)))).toEqual([true, true, true]);
    await act(async () => toastManager.close());
  });

  test("Copy image asks the shell to copy that file, and the button says Copied!", async () => {
    const calls = await saved();
    await click(buttonLabelled("Copy image"));
    expect(calls.copied).toEqual([PATH]);
    expect(buttonLabelled("Copied!")?.disabled).toBe(true);
    await act(async () => toastManager.close());
  });

  test("Copy path writes the file's path to the clipboard", async () => {
    const calls = await saved();
    await click(buttonLabelled("Copy path"));
    expect(calls.written).toEqual([PATH]);
    await act(async () => toastManager.close());
  });

  test("Reveal in Finder asks the shell to show that file", async () => {
    const calls = await saved();
    await click(buttonLabelled("Reveal in Finder"));
    expect(calls.revealed).toEqual([PATH]);
    await act(async () => toastManager.close());
  });

  test("a failed copy turns the toast into the error", async () => {
    await saved({ copyScreenshot: async () => { throw new Error("That screenshot is no longer on this machine."); } });
    await click(buttonLabelled("Copy image"));
    expect(document.body.textContent).toContain("Unable to copy screenshot");
    expect(document.body.textContent).toContain("no longer on this machine");
    await act(async () => toastManager.close());
  });

  test("a failed capture is its own error toast", async () => {
    await mount(<Toaster />);
    await act(async () => void showScreenshotFailure(new Error("There is no page loaded in this tab to capture.")));
    await flush(() => document.body.textContent?.includes("Unable to capture screenshot") ?? false);
    expect(document.body.textContent).toContain("no page loaded");
    await act(async () => toastManager.close());
  });
});
