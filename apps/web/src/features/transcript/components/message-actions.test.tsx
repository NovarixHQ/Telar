import { describe, expect, test } from "bun:test";
import { act } from "react";
import { flush, installTestDom, mount, press } from "@/test/dom";
import { MessageActions } from "./message-actions";

installTestDom();

describe("the row under a message", () => {
  test("Copy puts the message on the clipboard and says it did", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void written.push(text) } });
    const { host } = await mount(<MessageActions text="Fixed **it**." at={Date.now()} />);
    await press(host.querySelector('button[aria-label="Copy"]')!);
    expect(written).toEqual(["Fixed **it**."]);
    expect(host.querySelector('button[aria-label="Copied"]')).not.toBeNull();
  });

  test("its time opens the full date in a tooltip", async () => {
    const { host } = await mount(<MessageActions text="Done." at={Date.now()} />);
    act(() => host.querySelector("time")!.focus());
    await flush(() => document.querySelector("[data-slot=tooltip-content]") !== null);
    expect(document.querySelector("[data-slot=tooltip-content]")?.textContent).toContain(String(new Date().getFullYear()));
  });

  test("a message with no words offers nothing to copy", async () => {
    const { host } = await mount(<MessageActions text="  " at={Date.now()} />);
    expect(host.querySelector('button[aria-label="Copy"]')).toBeNull();
  });
});
