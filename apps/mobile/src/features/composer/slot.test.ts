import { expect, test } from "bun:test";
import { composerSlot } from "./slot";

test("an empty box sends nothing while idle and stops a running turn", () => {
  expect(composerSlot("  ", false, false)).toEqual({ kind: "send", enabled: false, label: "Send" });
  expect(composerSlot("", true, false)).toEqual({ kind: "stop", enabled: true, label: "Stop the running turn" });
});

test("text sends, or queues behind a running turn", () => {
  expect(composerSlot("hi", false, false)).toEqual({ kind: "send", enabled: true, label: "Send" });
  expect(composerSlot("hi", true, false)).toEqual({ kind: "send", enabled: true, label: "Queue" });
});

test("nothing can be pressed twice while a send or stop is on its way", () => {
  expect(composerSlot("hi", false, true).enabled).toBe(false);
  expect(composerSlot("", true, true).enabled).toBe(false);
});
