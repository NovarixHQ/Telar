import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom } from "@/test/dom";
import { liveRow, mountRail, project, pushes, stubRail } from "@/test/rail";

installTestDom();

const press = (key: string, code: string) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, code, metaKey: true, shiftKey: true, bubbles: true })));

describe("⌘⇧[ and ⌘⇧] walk the rail", () => {
  test("with no session open, next opens the top row and previous opens the bottom one, past the ninth", async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => liveRow(`s${index}`, { idleHours: index / 100 }));
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions } }));
    await mountRail();

    await press("}", "BracketRight");
    expect(pushes.at(-1)).toBe("/projects/p1/sessions/s0");

    await press("{", "BracketLeft");
    expect(pushes.at(-1)).toBe("/projects/p1/sessions/s11");
  });
});
