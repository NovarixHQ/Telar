import { describe, expect, test } from "bun:test";
import type { SessionAssignment } from "@telar/engine-client";
import { nestRail, parentOf } from "./nesting";
import type { RailRow } from "./rail";

const row = (sessionId: string, over: Partial<RailRow> = {}): RailRow => ({
  key: `mini/${sessionId}`,
  hostId: "mini",
  sessionId,
  title: sessionId,
  driver: "claude",
  activity: "idle",
  archived: false,
  busy: false,
  pinned: false,
  unread: false,
  status: { kind: "idle", label: "1h ago" },
  createdAt: 0,
  updatedAt: 0,
  lastActivity: 0,
  ...over,
});

const assignment = (fromSessionId: string, receivedAt: number, outcome?: "detached"): SessionAssignment =>
  ({ taskRunId: `t-${fromSessionId}`, fromSessionId, receivedAt, runId: "r", ...(outcome ? { outcome } : {}) }) as SessionAssignment;

describe("parentOf", () => {
  test("prefers startedFrom, else the earliest assignment that is not detached, never itself", () => {
    expect(parentOf("b", "a", [assignment("z", 1)])).toBe("a");
    expect(parentOf("b", undefined, [assignment("late", 9), assignment("gone", 1, "detached"), assignment("early", 5)])).toBe("early");
    expect(parentOf("b", "b")).toBeUndefined();
  });
});

describe("nestRail", () => {
  const view = (rail: ReturnType<typeof nestRail>["rows"]) => rail.map(({ row, family, nested }) => `${nested ? "  " : ""}${row.sessionId}${family ? ` (${family.count}${family.needsYou ? `, ${family.needsYou} need you` : ""})` : ""}`);

  test("a builder folds under its orchestrator; collapsed families hide idle children", () => {
    const rail = { pinned: [], rows: [row("lead"), row("builder", { parentId: "lead" }), row("solo")] };
    expect(view(nestRail(rail, new Set()).rows)).toEqual(["lead (1)", "solo"]);
    expect(view(nestRail(rail, new Set(["mini:lead"])).rows)).toEqual(["lead (1)", "  builder", "solo"]);
  });

  test("a child that needs you stays visible while its family is collapsed, and grandchildren join the root", () => {
    const rail = { pinned: [], rows: [row("lead"), row("mid", { parentId: "lead" }), row("leaf", { parentId: "mid", activity: "blocked" })] };
    expect(view(nestRail(rail, new Set()).rows)).toEqual(["lead (2, 1 need you)", "  leaf"]);
  });

  test("pinned rows stay roots in the pinned section, and a parent on another host or missing leaves the row on top", () => {
    const rail = { pinned: [row("pinned-child", { parentId: "lead", pinned: true })], rows: [row("lead"), row("orphan", { parentId: "elsewhere" })] };
    const nested = nestRail(rail, new Set());
    expect(view(nested.pinned)).toEqual(["pinned-child"]);
    expect(view(nested.rows)).toEqual(["lead", "orphan"]);
  });

  test("a cycle never hides a row", () => {
    const rail = { pinned: [], rows: [row("a", { parentId: "b" }), row("b", { parentId: "a" })] };
    expect(nestRail(rail, new Set()).rows.map((entry) => entry.row.sessionId).sort()).toEqual(["a", "b"]);
  });
});
