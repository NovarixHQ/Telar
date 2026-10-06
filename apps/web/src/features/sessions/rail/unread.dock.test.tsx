import { afterEach, describe, expect, test } from "bun:test";
import { installTestDom } from "@/test/dom";
import { liveRow, mountRail, nextPass, project, stubRail } from "@/test/rail";

installTestDom();

const told: [number, boolean][] = [];
const bridge = window as { telarDesktop?: unknown };

afterEach(() => {
  delete bridge.telarDesktop;
  told.length = 0;
});

describe("the rail tells the desktop shell its unread count", () => {
  test("the count follows the list, down to zero", async () => {
    bridge.telarDesktop = { app: { relaunch: async () => {}, setUnread: async (count: number, open: boolean) => void told.push([count, open]) } };
    let sessions = [liveRow("a", { lastTurnSequence: 3, lastReadTurnSequence: 1 }), liveRow("b", { lastTurnSequence: 1 })];
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions } }));
    await mountRail();
    expect(told.at(-1)).toEqual([2, false]);
    sessions = [liveRow("a", { lastTurnSequence: 3, lastReadTurnSequence: 3 }), liveRow("b", { lastTurnSequence: 1, lastReadTurnSequence: 1 })];
    await nextPass();
    expect(told.at(-1)).toEqual([0, false]);
  });
});
