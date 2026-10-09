import { describe, expect, test } from "bun:test";
import { HostConnection } from "../../platform/connection";
import { fakeClock, fakeNetwork, identityOf, until } from "../../platform/connection/testing";
import { cockpitLink, requestFor, rowMenu, sendRailRequest, snoozePresets, wakeLabel, type RailAction, type RowMenuItem } from "./rail-actions";
import type { RailRow } from "./rail";

const MAC = "http://100.70.1.2:3000";
const HOST = "host_00000000-0000-0000-0000-000000000001";
const HOUR = 3_600_000;

const row = (over: Partial<RailRow> = {}): RailRow => ({
  key: `mini/s1`,
  hostId: "mini",
  sessionId: "s1",
  title: "Fix the rail",
  projectId: "p1",
  projectName: "Telar",
  driver: "claude",
  path: "/code/telar",
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

async function sent(action: RailAction) {
  const bodies: { method: string; path: string; body: unknown }[] = [];
  const network = fakeNetwork({
    [MAC]: (path, init) => {
      if (path === "/api/identity") return identityOf(HOST);
      bodies.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ session: {}, deleted: true, changed: true });
    },
  });
  const connection = new HostConnection({ hostId: HOST, name: "Mini", token: "tlr_phone", paired: [MAC] }, { fetch: network.fetch, clock: fakeClock(), random: () => 0 });
  connection.start();
  await until(connection, "online");
  await sendRailRequest(connection, "s1", requestFor(action)!);
  return bodies;
}

describe("the requests a rail action sends", () => {
  test.each<[string, RailAction, string, unknown]>([
    ["pin", { kind: "pin", pinned: true }, "PATCH", { settledOverride: "active" }],
    ["unpin", { kind: "pin", pinned: false }, "PATCH", { settledOverride: null }],
    ["settle", { kind: "settle", settled: true }, "PATCH", { settledOverride: "settled" }],
    ["un-settle", { kind: "settle", settled: false }, "PATCH", { settledOverride: "active" }],
    ["snooze", { kind: "snooze", until: 1_800_000_000_000 }, "PATCH", { snoozedUntil: 1_800_000_000_000 }],
    ["wake", { kind: "wake" }, "PATCH", { settledOverride: "active", snoozedUntil: null }],
    ["rename", { kind: "rename", title: "New title" }, "PATCH", { title: "New title" }],
  ])("%s patches the session", async (_, action, method, body) => {
    const [request] = await sent(action);
    expect(request).toMatchObject({ method, body });
    expect(request?.path).toEndWith("/sessions/s1");
  });

  test("regenerate title posts to its own route", async () => {
    const [request] = await sent({ kind: "regenerate-title" });
    expect(request?.method).toBe("POST");
    expect(request?.path).toEndWith("/sessions/s1/regenerate-title");
  });

  test("delete removes the session", async () => {
    const [request] = await sent({ kind: "delete" });
    expect(request?.method).toBe("DELETE");
    expect(request?.path).toEndWith("/sessions/s1");
  });

  test("copying and starting a session ask nothing of the engine", () => {
    expect(requestFor({ kind: "copy", text: "x" })).toBeUndefined();
    expect(requestFor({ kind: "new-session", projectId: "p1" })).toBeUndefined();
  });
});

const NOW = new Date(2026, 9, 8, 14, 30);
const ids = (items: RowMenuItem[]) => items.map((item) => item.id);
const item = (items: RowMenuItem[], id: string) => items.find((entry) => entry.id === id)!;

describe("rowMenu", () => {
  test("an idle row offers every action, the copy submenu holding link, path, branch and id", () => {
    const menu = rowMenu(row({ branch: "feat/rail" }), { link: "http://mac/projects/p1/sessions/s1", now: NOW });
    expect(ids(menu)).toEqual(["new-session", "pin", "settle", "snooze", "rename", "regenerate-title", "copy", "delete"]);
    expect(item(menu, "new-session")).toMatchObject({ label: "New session on feat/rail", action: { kind: "new-session", projectId: "p1", baseRef: "feat/rail" } });
    expect(item(menu, "copy").children?.map((child) => child.action)).toEqual([
      { kind: "copy", text: "http://mac/projects/p1/sessions/s1" },
      { kind: "copy", text: "/code/telar" },
      { kind: "copy", text: "feat/rail" },
      { kind: "copy", text: "s1" },
    ]);
    expect(menu.some((entry) => entry.disabled)).toBe(false);
  });

  test("a working row cannot be settled or deleted, and says why", () => {
    const menu = rowMenu(row({ activity: "working" }), { now: NOW });
    expect(item(menu, "settle").disabled).toBe("A turn is running here.");
    expect(item(menu, "delete").disabled).toBe("A turn is running. Stop it before deleting.");
  });

  test("a row waiting on you cannot be snoozed", () => {
    expect(item(rowMenu(row({ activity: "blocked" }), { now: NOW }), "snooze").disabled).toBe("Something here is waiting on you.");
  });

  test("a settled row offers Un-settle; a pinned one Unpin", () => {
    const menu = rowMenu(row({ pinned: true }), { shelf: "settled", now: NOW });
    expect(item(menu, "settle")).toMatchObject({ label: "Un-settle", action: { kind: "settle", settled: false } });
    expect(item(menu, "pin")).toMatchObject({ label: "Unpin", action: { kind: "pin", pinned: false } });
  });

  test("a snoozed row offers Wake now with the time left", () => {
    const menu = rowMenu(row({ status: { kind: "snoozed", label: "in 3h" }, snoozedUntil: NOW.getTime() + 2.5 * HOUR }), { shelf: "snoozed", now: NOW });
    expect(item(menu, "snooze")).toMatchObject({ label: "Wake now", detail: "3h", action: { kind: "wake" } });
  });

  test("an archived row keeps only new session, copy and delete live", () => {
    const menu = rowMenu(row({ archived: true }), { now: NOW });
    expect(ids(menu)).toEqual(["new-session", "rename", "regenerate-title", "copy", "delete"]);
    expect(item(menu, "rename").disabled).toBe("This conversation is over.");
  });

  test("a row with no project cannot start a sibling", () => {
    const { projectId: _, ...loose } = row();
    expect(item(rowMenu(loose, { now: NOW }), "new-session")).toMatchObject({ disabled: "This session belongs to no project.", label: "New session in Telar" });
  });
});

describe("snoozePresets", () => {
  test("an afternoon offers this evening, tomorrow at 9 and Monday at 9", () => {
    const presets = snoozePresets(NOW);
    expect(presets.map((preset) => preset.label)).toEqual(["In 1 hour", "In 3 hours", "This evening", "Tomorrow", "Next week"]);
    expect(presets.map((preset) => new Date(preset.until))).toEqual([
      new Date(2026, 9, 8, 15, 30),
      new Date(2026, 9, 8, 17, 30),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 9, 9),
      new Date(2026, 9, 12, 9),
    ]);
  });

  test("this evening is left out when it is under an hour away, and next week from a Monday is a week on", () => {
    const presets = snoozePresets(new Date(2026, 9, 12, 17, 30));
    expect(presets.map((preset) => preset.id)).toEqual(["hour", "three-hours", "tomorrow", "next-week"]);
    expect(new Date(presets.at(-1)!.until)).toEqual(new Date(2026, 9, 19, 9));
  });
});

test("wakeLabel rounds up to minutes, hours or days", () => {
  expect([wakeLabel(30_000, 0), wakeLabel(45 * 60_000, 0), wakeLabel(HOUR + 1, 0), wakeLabel(25 * HOUR, 0), wakeLabel(0, 1)]).toEqual(["1m", "45m", "2h", "2d", "now"]);
});

test("cockpitLink points at the session under its project", () => {
  expect(cockpitLink("http://mac:3000/", { projectId: "p1", sessionId: "s1" })).toBe("http://mac:3000/projects/p1/sessions/s1");
  expect(cockpitLink("http://mac:3000", { sessionId: "s1" })).toBe("http://mac:3000");
});
