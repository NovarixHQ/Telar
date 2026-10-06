import { describe, expect, test } from "bun:test";
import { bandOf, type SidebarSession } from "../session-list";
import { railUnread } from "./unread";

const NOW = 10_000_000;

const row = (id: string, over: Partial<SidebarSession> = {}): SidebarSession => ({
  id,
  title: id,
  projectId: "p1",
  activity: "idle",
  createdAt: NOW - 1000,
  updatedAt: NOW - 1000,
  archived: false,
  driver: "claude",
  ...over,
});
const unread = { lastTurnSequence: 2, lastReadTurnSequence: 1 };
const bandFor = (session: SidebarSession) => bandOf(session, { now: NOW, autoSettleAfterHours: null });

describe("the Dock's unread count", () => {
  test("counts each row with an answer not yet read, and none that were read", () => {
    const rows = [row("a", unread), row("b", unread), row("read", { lastTurnSequence: 2, lastReadTurnSequence: 2 }), row("never")];
    expect(railUnread(rows, undefined, bandFor)).toEqual({ count: 2, openUnread: false });
  });

  test("a builder filed under its orchestrator does not count", () => {
    const rows = [row("lead", unread), row("builder", { ...unread, startedFrom: { sessionId: "lead" } })];
    expect(railUnread(rows, undefined, bandFor).count).toBe(1);
  });

  test("blocked, working and queued rows do not count", () => {
    const rows = (["blocked", "working", "queued"] as const).map((activity) => row(activity, { ...unread, activity }));
    expect(railUnread(rows, undefined, bandFor).count).toBe(0);
  });

  test("settled and snoozed rows do not count", () => {
    const rows = [row("settled", { ...unread, settledOverride: "settled" }), row("snoozed", { ...unread, snoozedUntil: NOW + 60_000, snoozedAt: NOW - 10 })];
    expect(railUnread(rows, undefined, bandFor).count).toBe(0);
  });

  test("the open row is reported apart, for the shell to count only while its window is not focused", () => {
    const rows = [row("open", unread), row("other", unread)];
    expect(railUnread(rows, "open", bandFor)).toEqual({ count: 1, openUnread: true });
    expect(railUnread([row("open")], "open", bandFor)).toEqual({ count: 0, openUnread: false });
  });
});
