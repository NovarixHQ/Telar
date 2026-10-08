import { expect, test } from "bun:test";
import type { LiveSessionRow, LiveSessionsAnswer } from "@telar/engine-client";
import { railRows } from "./rail";

const NOW = Date.UTC(2026, 9, 8, 12);
const HOUR = 3_600_000;

const row = (id: string, over: Partial<LiveSessionRow> = {}) =>
  ({ id, title: `Session ${id}`, state: "active", activity: "idle", createdAt: NOW - 5 * HOUR, updatedAt: NOW - HOUR, ...over }) as LiveSessionRow;

const answer = (sessions: LiveSessionRow[], over: Partial<LiveSessionsAnswer> = {}): LiveSessionsAnswer =>
  ({ sessions, projects: [{ id: "p1", name: "Telar" }], ...over }) as LiveSessionsAnswer;

test("rows from every host merge, newest activity first, with the project's name", () => {
  const rows = railRows(
    [
      { hostId: "mini", answer: answer([row("a", { projectId: "p1", updatedAt: NOW - 2 * HOUR })]) },
      { hostId: "studio", answer: answer([row("b", { activityAt: NOW - 60_000 })]) },
    ],
    NOW,
  );
  expect(rows.map((entry) => [entry.key, entry.projectName, entry.status.label])).toEqual([
    ["studio/b", undefined, "1m"],
    ["mini/a", "Telar", "2h"],
  ]);
});

test("status follows what the session is doing", () => {
  const rows = railRows(
    [
      {
        hostId: "mini",
        answer: answer([
          row("blocked", { activity: "blocked", updatedAt: NOW - 4 }),
          row("working", { activity: "working", updatedAt: NOW - 3 }),
          row("failed", { lastTurnFailed: true, updatedAt: NOW - 2 }),
        ]),
      },
    ],
    NOW,
  );
  expect(rows.map((entry) => [entry.sessionId, entry.status])).toEqual([
    ["failed", { label: "Failed", tone: "failed" }],
    ["working", { label: "Working", tone: "working" }],
    ["blocked", { label: "Needs you", tone: "needs-you" }],
  ]);
});

test("an unread result shows a dot unless the session is busy", () => {
  const unread = { lastTurnSequence: 3, lastReadTurnSequence: 2 };
  const rows = railRows([{ hostId: "mini", answer: answer([row("idle", unread), row("busy", { ...unread, activity: "working" })]) }], NOW);
  expect(Object.fromEntries(rows.map((entry) => [entry.sessionId, entry.unread]))).toEqual({ idle: true, busy: false });
});

test("settled, snoozed and long-idle sessions stay off the rail, by the host's own settle policy", () => {
  const sessions = [
    row("settled", { settledOverride: "settled" }),
    row("archived", { state: "archived" }),
    row("snoozed", { snoozedUntil: NOW + HOUR, snoozedAt: NOW - HOUR }),
    row("old", { updatedAt: NOW - 30 * HOUR }),
  ];
  expect(railRows([{ hostId: "mini", answer: answer(sessions) }], NOW).map((entry) => entry.sessionId)).toEqual(["old"]);
  const strict = answer(sessions, { inbox: { autoSettleAfterHours: 24, settleDelegatedAfterHours: 1, settledTerminalLimit: 5 } });
  expect(railRows([{ hostId: "mini", answer: strict }], NOW)).toEqual([]);
});

test("a host that has not answered yet adds nothing", () => {
  expect(railRows([{ hostId: "mini", answer: undefined }], NOW)).toEqual([]);
});
