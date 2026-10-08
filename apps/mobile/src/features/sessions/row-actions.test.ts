import { describe, expect, test } from "bun:test";
import type { RailRow } from "./rail";
import { rowMenu, snoozePresets, wakeLabel } from "./row-actions";

const row = (over: Partial<RailRow> = {}): RailRow => ({
  key: "mini/s1",
  hostId: "mini",
  sessionId: "s1",
  title: "Session",
  driver: "claude",
  path: "/repo",
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

const ids = (items: ReturnType<typeof rowMenu>) => items.map((item) => item.id);

describe("snoozePresets", () => {
  test("offers this evening only when it is more than an hour away, and next week lands on Monday 9:00", () => {
    const wednesdayMorning = new Date(2026, 9, 7, 10, 30);
    const presets = snoozePresets(wednesdayMorning);
    expect(presets.map((preset) => [preset.id, preset.when])).toEqual([
      ["hour", "11:30 AM"],
      ["three-hours", "1:30 PM"],
      ["evening", "6:00 PM"],
      ["tomorrow", "9:00 AM"],
      ["next-week", "Mon 9:00 AM"],
    ]);
    expect(new Date(presets.at(-1)!.until).getDate()).toBe(12);
    expect(snoozePresets(new Date(2026, 9, 7, 17, 30)).map((preset) => preset.id)).not.toContain("evening");
  });

  test("on a Monday, next week is the following Monday", () => {
    const monday = new Date(2026, 9, 5, 8, 0);
    expect(new Date(snoozePresets(monday).at(-1)!.until).getDate()).toBe(12);
  });
});

test("wakeLabel rounds up to the next unit", () => {
  expect(wakeLabel(1000 + 30_000, 1000)).toBe("1m");
  expect(wakeLabel(1000 + 90 * 60_000, 1000)).toBe("2h");
  expect(wakeLabel(1000 + 25 * 3_600_000, 1000)).toBe("2d");
  expect(wakeLabel(0, 1000)).toBe("now");
});

describe("rowMenu", () => {
  const now = new Date(2026, 9, 7, 10, 0);

  test("an idle row can be pinned, settled, snoozed, renamed, copied and deleted", () => {
    const items = rowMenu(row({ branch: "feat/x" }), now);
    expect(ids(items)).toEqual(["pin", "settle", "snooze", "rename", "regenerate-title", "copy", "delete"]);
    expect(items.every((item) => item.disabled === undefined)).toBe(true);
    expect(items.find((item) => item.id === "copy")!.children!.map((item) => item.verb)).toEqual([
      { kind: "copy", text: "/repo" },
      { kind: "copy", text: "feat/x" },
      { kind: "copy", text: "s1" },
    ]);
  });

  test("a pinned, snoozed or settled row offers the way back", () => {
    expect(rowMenu(row({ pinned: true }), now)[0]).toMatchObject({ label: "Unpin", verb: { kind: "pin", pinned: false } });
    expect(rowMenu(row({ status: { kind: "snoozed", label: "in 1h" }, shelf: "snoozed", snoozedUntil: now.getTime() + 45 * 60_000 }), now).find((item) => item.id === "snooze")).toMatchObject({ label: "Wake now · 45m", verb: { kind: "snooze", until: null } });
    expect(rowMenu(row({ shelf: "settled" }), now).find((item) => item.id === "settle")).toMatchObject({ label: "Un-settle", verb: { kind: "settle", settled: false } });
  });

  test("a waiting or running row refuses settle, snooze and delete with a reason", () => {
    const waiting = rowMenu(row({ activity: "blocked", busy: true }), now);
    expect(["settle", "snooze", "delete"].map((id) => Boolean(waiting.find((item) => item.id === id)!.disabled))).toEqual([true, true, true]);
    const running = rowMenu(row({ activity: "working", busy: true }), now);
    expect(running.find((item) => item.id === "delete")!.disabled).toBe("A turn is running. Stop it before deleting.");
  });

  test("an archived row only renames, copies and deletes, with rename refused", () => {
    const items = rowMenu(row({ archived: true }), now);
    expect(ids(items)).toEqual(["rename", "regenerate-title", "copy", "delete"]);
    expect(items[0]!.disabled).toBe("This conversation is over.");
  });
});
