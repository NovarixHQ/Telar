import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";

installTestDom();
const { default: QuickComposerError } = await import("./error");

describe("the quick composer's error screen", () => {
  test("shows the error and its first stack lines, and copies them", async () => {
    const error = new TypeError("rows is not iterable");
    error.stack = ["TypeError: rows is not iterable", ...Array.from({ length: 9 }, (_, i) => `    at frame${i} (quick.js:${i}:1)`)].join("\n");
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
    const { host } = await mount(<QuickComposerError error={error} retry={() => {}} />);
    const report = host.querySelector('[data-slot="quick-error"]')!.textContent!;
    expect(host.textContent).toContain("This page couldn’t load.");
    expect(report.split("\n")).toEqual(["TypeError: rows is not iterable", ...Array.from({ length: 6 }, (_, i) => `at frame${i} (quick.js:${i}:1)`)]);
    const copy = [...host.querySelectorAll("button")].find((button) => button.textContent === "Copy")!;
    await act(async () => copy.click());
    expect(copied).toEqual([report]);
  });
});
