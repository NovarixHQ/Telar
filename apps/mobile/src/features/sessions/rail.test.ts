import { describe, expect, test } from "bun:test";
import type { LiveSessionRow, LiveSessionsAnswer } from "@telar/engine-client";
import { flatRail, hostFailures, railSections, relativeTime, searchRail, withShelf } from "./rail";

const NOW = Date.UTC(2026, 9, 8, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const row = (id: string, over: Partial<LiveSessionRow> = {}) =>
  ({ id, title: `Session ${id}`, state: "active", activity: "idle", driver: "claude", workspace: { mode: "local", path: "/p" }, createdAt: NOW - 5 * HOUR, updatedAt: NOW - HOUR, ...over }) as LiveSessionRow;

const answer = (sessions: LiveSessionRow[], over: Partial<LiveSessionsAnswer> = {}): LiveSessionsAnswer =>
  ({ sessions, projects: [{ id: "p1", name: "Telar", iconEmoji: "🧵" }], ...over }) as LiveSessionsAnswer;

describe("railSections", () => {
  test("merges every host, newest-created first, with the project's name and mark", () => {
    const { active } = railSections(
      [
        { hostId: "mini", answer: answer([row("a", { projectId: "p1", createdAt: NOW - 2 * HOUR })]) },
        { hostId: "studio", answer: answer([row("b", { createdAt: NOW - HOUR, workspace: { mode: "worktree", path: "/w", branch: "feat/x" } })]) },
      ],
      NOW,
    );
    expect(active.map((entry) => [entry.key, entry.projectName, entry.projectIconEmoji, entry.branch])).toEqual([
      ["studio/b", undefined, undefined, "feat/x"],
      ["mini/a", "Telar", "🧵", undefined],
    ]);
  });

  test("the computer filter keeps one host", () => {
    const inboxes = [
      { hostId: "mini", answer: answer([row("a")]) },
      { hostId: "studio", answer: answer([row("b")]) },
    ];
    expect(railSections(inboxes, NOW, "studio").active.map((entry) => entry.key)).toEqual(["studio/b"]);
  });

  test("snoozed and settled rows leave the active list for their shelves", () => {
    const sections = railSections(
      [{ hostId: "mini", answer: answer([row("live"), row("snoozed", { snoozedUntil: NOW + HOUR, snoozedAt: NOW - HOUR }), row("settled", { settledOverride: "settled" })]) }],
      NOW,
    );
    expect([sections.active, sections.snoozed, sections.settled].map((rows) => rows.map((entry) => entry.sessionId))).toEqual([["live"], ["snoozed"], ["settled"]]);
    expect(sections.snoozed[0]!.status).toEqual({ kind: "snoozed", label: "in 1h" });
  });

  test("a host that has not answered yet adds nothing", () => {
    expect(railSections([{ hostId: "mini", answer: undefined }], NOW)).toEqual({ active: [], snoozed: [], settled: [] });
  });
});

describe("status slot", () => {
  const statusOf = (over: Partial<LiveSessionRow>) => railSections([{ hostId: "mini", answer: answer([row("x", over)]) }], NOW).active[0]!;

  test("follows what the session is doing, and tints the accent bar", () => {
    expect([statusOf({ activity: "blocked" }).status, statusOf({ activity: "blocked" }).accent]).toEqual([{ kind: "needs-you" }, "amber"]);
    expect([statusOf({ activity: "working" }).status, statusOf({ activity: "working" }).accent]).toEqual([{ kind: "working", label: "Working" }, "accent"]);
    expect(statusOf({ activity: "queued" }).status).toEqual({ kind: "working", label: "Queued" });
    expect(statusOf({ activity: "monitoring" }).status).toEqual({ kind: "monitoring" });
    expect([statusOf({ lastTurnFailed: true }).status, statusOf({ lastTurnFailed: true }).accent]).toEqual([{ kind: "failed" }, undefined]);
  });

  test("an idle row shows when it last moved", () => {
    expect(statusOf({ activityAt: NOW - 11 * HOUR, updatedAt: NOW - 2 * HOUR }).status).toEqual({ kind: "idle", label: "11h ago" });
    expect(statusOf({ updatedAt: NOW - 3 * MINUTE }).status).toEqual({ kind: "idle", label: "3m ago" });
  });

  test("an unread result shows a dot unless the session is busy", () => {
    const unread = { lastTurnSequence: 3, lastReadTurnSequence: 2 };
    expect([statusOf(unread).unread, statusOf({ ...unread, activity: "working" }).unread]).toEqual([true, false]);
  });
});

test("relativeTime abbreviates like the Swift app", () => {
  expect(relativeTime(NOW - 30 * 1000, NOW)).toBe("30s ago");
  expect(relativeTime(NOW - 26 * HOUR, NOW)).toBe("1d ago");
  expect(relativeTime(NOW - 15 * 24 * HOUR, NOW)).toBe("2w ago");
  expect(relativeTime(NOW + 3 * HOUR, NOW)).toBe("in 3h");
});

describe("flatRail", () => {
  const sections = railSections(
    [
      {
        hostId: "mini",
        answer: answer(
          [
            row("old-busy", { createdAt: NOW - 9 * HOUR, activityAt: NOW - MINUTE }),
            row("new-quiet", { createdAt: NOW - HOUR, updatedAt: NOW - HOUR }),
            row("pin-a", { settledOverride: "active", createdAt: NOW - 3 * HOUR }),
            row("pin-b", { settledOverride: "active", createdAt: NOW - 2 * HOUR }),
            row("pin-c", { settledOverride: "active", createdAt: NOW - 30 * MINUTE }),
          ],
          { layout: { projectOrder: [], sessionOrder: {}, pinnedOrder: ["pin-a", "pin-b"], mode: "flat" } },
        ),
      },
    ],
    NOW,
  );

  test("pins follow the saved order, unsaved pins after; the rest go by newest activity", () => {
    const rail = flatRail(sections.active, new Map([["mini", ["pin-a", "pin-b"]]]));
    expect(rail.pinned.map((entry) => entry.sessionId)).toEqual(["pin-a", "pin-b", "pin-c"]);
    expect(rail.rows.map((entry) => entry.sessionId)).toEqual(["old-busy", "new-quiet"]);
  });
});

test("hostFailures flags unpaired and unreachable computers, stale when saved rows remain", () => {
  const health = (hostId: string, state: "online" | "backoff" | "blocked" | "connecting", over: { failed?: string; answered?: boolean } = {}) => ({ hostId, name: hostId, state, answered: true, ...over });
  expect(hostFailures([health("ok", "online"), health("waking", "connecting"), health("away", "backoff"), health("unpaired", "blocked", { answered: false }), health("erroring", "online", { failed: "500" })])).toEqual([
    { hostId: "away", name: "away", needsPairing: false, stale: true },
    { hostId: "unpaired", name: "unpaired", needsPairing: true, stale: false },
    { hostId: "erroring", name: "erroring", needsPairing: false, stale: true },
  ]);
});

test("search matches title, project or computer, ignoring case and accents", () => {
  const { active } = railSections(
    [
      { hostId: "mini", answer: answer([row("a", { title: "Café latency" }), row("b", { projectId: "p1" })]) },
      { hostId: "studio", answer: answer([row("c")]) },
    ],
    NOW,
  );
  const names: Record<string, string> = { mini: "Mac mini", studio: "Studio" };
  const found = (query: string) => searchRail(active, query, (hostId) => names[hostId]).map((entry) => entry.sessionId);
  expect(found("cafe")).toEqual(["a"]);
  expect(found("TELAR")).toEqual(["b"]);
  expect(found("studio")).toEqual(["c"]);
  expect(found("nothing")).toEqual([]);
});

test("withShelf adds the shelf's sessions the list does not hold, keeping the list's own rows", () => {
  const list = answer([row("a", { title: "fresh" })], { assignments: { a: [] } });
  const shelf = answer([row("a", { title: "stale" }), row("b")], { assignments: { a: [{ coordinatorSessionId: "x" }] as never, b: [] } });
  const merged = withShelf(list, shelf)!;
  expect(merged.sessions.map((session) => [session.id, session.title])).toEqual([
    ["a", "fresh"],
    ["b", "Session b"],
  ]);
  expect(merged.assignments).toEqual({ a: [], b: [] });
  expect(withShelf(list, undefined)).toBe(list);
});
