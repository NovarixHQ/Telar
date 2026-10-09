import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";

installTestDom();
const { default: QuickComposerError } = await import("./error");

describe("the quick composer's error screen", () => {
  test("shows the message first and the whole stack below it, and copies both", async () => {
    const error = new TypeError("rows is not iterable");
    error.stack = ["TypeError: rows is not iterable", ...Array.from({ length: 9 }, (_, i) => `    at frame${i} (quick.js:${i}:1)`)].join("\n");
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
    const { host } = await mount(<QuickComposerError error={error} retry={() => {}} />);
    const message = host.querySelector('[data-slot="quick-error-message"]')!;
    const stack = host.querySelector('[data-slot="quick-error-stack"]')!;
    expect(host.textContent).toContain("This page couldn’t load.");
    expect(message.textContent).toBe("TypeError: rows is not iterable");
    expect(message.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stack.textContent!.split("\n")).toHaveLength(9);
    const copy = [...host.querySelectorAll("button")].find((button) => button.textContent === "Copy")!;
    await act(async () => copy.click());
    expect(copied).toEqual([`TypeError: rows is not iterable\n${stack.textContent}`]);
  });
});
