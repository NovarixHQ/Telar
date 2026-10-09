import { describe, expect, test } from "bun:test";
import { clip, initialCardState, type CardHost, type CardSession } from "./card";

const session = (id: string, activity: CardSession["activity"], extra: Partial<CardSession> = {}): CardSession => ({ id, title: `Title ${id}`, activity, ...extra });
const host = (hostId: string, sessions: CardSession[], projects: Record<string, string> = {}): CardHost => ({ hostId, name: `${hostId}.local`, sessions, projects: new Map(Object.entries(projects)) });

describe("initialCardState", () => {
  test("hides titles without previews and names the project instead", () => {
    const state = initialCardState([host("mac", [session("a", "working", { projectId: "p" })], { p: "Telar" })], false, 2_000);
    expect(state).toEqual({
      title: "Telar work",
      status: "Working",
      updatedAt: 2,
      startedAt: 2,
      ended: false,
      sessionId: "a",
      activeCount: 1,
      rows: [{ id: "a", status: "Working", project: "Telar", hostId: "mac" }],
      hostId: "mac",
    });
  });

  test("folds builders under the session that started them and leads with what needs you", () => {
    const state = initialCardState(
      [host("mac", [session("root", "idle"), session("b1", "working", { startedFrom: { sessionId: "root" } }), session("b2", "blocked", { startedFrom: { sessionId: "root" } }), session("solo", "queued"), session("rest", "idle")])],
      true,
      0,
    );
    expect(state.activeCount).toBe(2);
    expect(state.title).toBe("2 active sessions");
    expect(state.rows.map((row) => [row.id, row.status, row.workers])).toEqual([
      ["root", "Needs you", 2],
      ["solo", "Queued", undefined],
    ]);
  });

  test("says who a session waits on, and names computers only when there are several", () => {
    const state = initialCardState(
      [host("one", [session("w", "idle", { activityDetail: { kind: "session", sessionId: "x", sessions: 2 } })]), host("two", [session("m", "monitoring", { activityAt: 5 })])],
      true,
      0,
    );
    expect(state.rows.map((row) => [row.id, row.status, row.host])).toEqual([
      ["w", "Waiting on 2 sessions", "one"],
      ["m", "Background", "two"],
    ]);
  });

  test("keeps at most five rows but counts every family", () => {
    const sessions = Array.from({ length: 7 }, (_, index) => session(`s${index}`, "working", { activityAt: index }));
    const state = initialCardState([host("mac", sessions)], true, 0);
    expect(state.activeCount).toBe(7);
    expect(state.rows.map((row) => row.id)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });
});

test("clip trims and ends long text with an ellipsis", () => {
  expect(clip("  short  ", 10)).toBe("short");
  expect(clip("abcdefghij k", 10)).toBe("abcdefghi…");
});
