import { expect, test } from "bun:test";
import { composerSlot } from "./slot";

test("an empty box sends nothing while idle and stops a running turn", () => {
  expect(composerSlot({ draft: "  ", running: false, busy: false })).toEqual({ kind: "send", enabled: false, label: "Send" });
  expect(composerSlot({ draft: "", running: true, busy: false })).toEqual({ kind: "stop", enabled: true, label: "Stop the running turn" });
});

test("text or an image sends, and queues behind a running turn or other queued messages", () => {
  expect(composerSlot({ draft: "hi", running: false, busy: false })).toEqual({ kind: "send", enabled: true, label: "Send" });
  expect(composerSlot({ draft: "", running: false, busy: false, hasImage: true })).toMatchObject({ kind: "send", enabled: true });
  expect(composerSlot({ draft: "", running: true, busy: false, hasImage: true })).toMatchObject({ kind: "send", label: "Queue" });
  expect(composerSlot({ draft: "hi", running: false, busy: false, queued: 1 }).label).toBe("Queue");
});

test("nothing can be pressed twice while a send or stop is on its way", () => {
  expect(composerSlot({ draft: "hi", running: false, busy: true }).enabled).toBe(false);
  expect(composerSlot({ draft: "", running: true, busy: true }).enabled).toBe(false);
});
