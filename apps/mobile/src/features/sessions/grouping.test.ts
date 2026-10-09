import { describe, expect, test } from "bun:test";
import type { SidebarLayout } from "@telar/engine-client";
import { byWakeTime, groupRail, movedProjectOrders } from "./grouping";
import type { RailRow } from "./rail";

const row = (hostId: string, sessionId: string, over: Partial<RailRow> = {}): RailRow => ({
  key: `${hostId}/${sessionId}`,
  hostId,
  sessionId,
  title: sessionId,
  projectId: "p1",
  projectName: "Telar",
  driver: "claude",
  activity: "idle",
  archived: false,
  pinned: false,
  unread: false,
  status: { kind: "idle", label: "1h ago" },
  createdAt: 0,
  updatedAt: 0,
  lastActivity: 0,
  ...over,
});

const layout = (over: Partial<SidebarLayout> = {}): SidebarLayout => ({ projectOrder: [], sessionOrder: {}, pinnedOrder: [], mode: "grouped", ...over });
const names: Record<string, string> = { mini: "Mini", studio: "Studio" };
const hostName = (hostId: string) => names[hostId];
const keys = (rows: RailRow[]) => rows.map((entry) => entry.key);

describe("groupRail", () => {
  test("blocked rows go to Needs you, pinned rows to their band, the rest under their project", () => {
    const grouped = groupRail(
      [row("mini", "a", { activity: "blocked", pinned: true }), row("mini", "b", { pinned: true }), row("mini", "c"), row("mini", "d", { projectId: "p2", projectName: "Atlas" })],
      new Map(),
      hostName,
    );
    expect(keys(grouped.attention)).toEqual(["mini/a"]);
    expect(keys(grouped.pinned)).toEqual(["mini/b"]);
    expect(grouped.projects.map((project) => [project.name, keys(project.rows)])).toEqual([
      ["Atlas", ["mini/d"]],
      ["Telar", ["mini/c"]],
    ]);
  });

  test("rows without a project are left out, as in the Swift app", () => {
    const { projectId: _, ...loose } = row("mini", "a");
    expect(groupRail([loose], new Map(), hostName).projects).toEqual([]);
  });

  test("a project shared by its remote is one band listing both computers", () => {
    const grouped = groupRail(
      [row("studio", "a", { projectId: "s-p", projectRemote: "git@github.com:o/telar.git" }), row("mini", "b", { projectId: "m-p", projectRemote: "git@github.com:o/telar.git" })],
      new Map(),
      hostName,
    );
    expect(grouped.projects).toHaveLength(1);
    expect(grouped.projects[0]).toMatchObject({ id: "repo:git@github.com:o/telar.git", layoutKey: "repo:git@github.com:o/telar.git", places: [{ hostId: "mini", projectId: "m-p" }, { hostId: "studio", projectId: "s-p" }] });
  });

  test("the saved orders rank projects, rows and pins; unranked ones follow by name and arrival", () => {
    const layouts = new Map([["mini", layout({ projectOrder: ["p2"], sessionOrder: { p1: ["c"] }, pinnedOrder: ["y", "x"] })]]);
    const grouped = groupRail(
      [row("mini", "x", { pinned: true }), row("mini", "y", { pinned: true }), row("mini", "b"), row("mini", "c"), row("mini", "d", { projectId: "p2", projectName: "Zed" }), row("mini", "e", { projectId: "p3", projectName: "Atlas" })],
      layouts,
      hostName,
    );
    expect(keys(grouped.pinned)).toEqual(["mini/y", "mini/x"]);
    expect(grouped.projects.map((project) => project.name)).toEqual(["Zed", "Atlas", "Telar"]);
    expect(keys(grouped.projects[2]!.rows)).toEqual(["mini/c", "mini/b"]);
  });

  test("a band shows the away label only when every row agrees", () => {
    const away = groupRail([row("mini", "a", { projectAway: "Drive away" }), row("mini", "b", { projectAway: "Drive away" })], new Map(), hostName);
    const mixed = groupRail([row("mini", "a", { projectAway: "Drive away" }), row("mini", "b")], new Map(), hostName);
    expect(away.projects[0]?.away).toBe("Drive away");
    expect(mixed.projects[0]?.away).toBeUndefined();
  });
});

describe("movedProjectOrders", () => {
  const projects = groupRail([row("mini", "a", { projectId: "p1", projectName: "Alpha" }), row("mini", "b", { projectId: "p2", projectName: "Beta" })], new Map(), hostName).projects;

  test("moving a band down swaps it with the next and keeps keys the phone did not draw", () => {
    const orders = movedProjectOrders(projects, "mini:p1", 1, new Map([["mini", layout({ projectOrder: ["gone", "p1"] })]]));
    expect(orders).toEqual(new Map([["mini", ["p2", "p1", "gone"]]]));
  });

  test("the first band cannot move up, and an unchanged order is not written", () => {
    expect(movedProjectOrders(projects, "mini:p1", -1, new Map()).size).toBe(0);
    expect(movedProjectOrders(projects, "mini:p2", -1, new Map([["mini", layout({ projectOrder: ["p2", "p1"] })]])).size).toBe(0);
  });
});

test("snoozed rows wake soonest first", () => {
  expect(keys(byWakeTime([row("mini", "late", { snoozedUntil: 3 }), row("mini", "soon", { snoozedUntil: 1 })]))).toEqual(["mini/soon", "mini/late"]);
});
