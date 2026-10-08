import type { SymbolName } from "../../ui";
import type { RailRow } from "./rail";

export type RowVerb =
  | { kind: "pin"; pinned: boolean }
  | { kind: "settle"; settled: boolean }
  | { kind: "snooze"; until: number | null }
  | { kind: "rename" }
  | { kind: "regenerate-title" }
  | { kind: "copy"; text: string }
  | { kind: "delete" };

export type RowMenuItem = { id: string; label: string; systemImage: SymbolName; disabled?: string; destructive?: boolean; verb?: RowVerb; children?: RowMenuItem[] };

export type SnoozePreset = { id: string; label: string; when: string; until: number };

const HOUR = 3_600_000;

const clock = (date: Date) => {
  const hours = date.getHours();
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};

const atHour = (base: Date, hour: number, addDays = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour, 0, 0, 0);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** In 1 hour, in 3 hours, this evening (if more than an hour away), tomorrow 9:00, next Monday 9:00. */
export function snoozePresets(now: Date): SnoozePreset[] {
  const preset = (id: string, label: string, at: Date, when = clock(at)): SnoozePreset => ({ id, label, when, until: at.getTime() });
  const presets = [preset("hour", "In 1 hour", new Date(now.getTime() + HOUR)), preset("three-hours", "In 3 hours", new Date(now.getTime() + 3 * HOUR))];
  const evening = atHour(now, 18);
  if (evening.getTime() - now.getTime() > HOUR) presets.push(preset("evening", "This evening", evening));
  presets.push(preset("tomorrow", "Tomorrow", atHour(now, 9, 1)));
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  const monday = atHour(now, 9, daysUntilMonday);
  presets.push(preset("next-week", "Next week", monday, `${WEEKDAYS[monday.getDay()]} ${clock(monday)}`));
  return presets;
}

/** Time left before a snoozed session wakes: "45m", "3h", "2d". */
export function wakeLabel(until: number, now: number): string {
  const left = until - now;
  if (left <= 0) return "now";
  if (left < HOUR) return `${Math.max(1, Math.ceil(left / 60_000))}m`;
  if (left < 24 * HOUR) return `${Math.ceil(left / HOUR)}h`;
  return `${Math.ceil(left / (24 * HOUR))}d`;
}

const WAITING = "Something here is waiting on you.";
const RUNNING = "A turn is running here.";
const ARCHIVED = "This conversation is over.";

/** The row's long-press menu, as the Swift app lists it. */
export function rowMenu(row: RailRow, now: Date): RowMenuItem[] {
  const items: RowMenuItem[] = [];
  const blocked = row.activity === "blocked";
  const working = row.busy && !blocked;
  if (!row.archived) {
    items.push(row.pinned ? { id: "pin", label: "Unpin", systemImage: "pin.slash", verb: { kind: "pin", pinned: false } } : { id: "pin", label: "Pin to the list", systemImage: "pin", verb: { kind: "pin", pinned: true } });
    const settled = row.shelf === "settled";
    items.push({
      id: "settle",
      label: settled ? "Un-settle" : "Settle",
      systemImage: settled ? "arrow.uturn.backward" : "checkmark",
      verb: { kind: "settle", settled: !settled },
      ...(settled ? {} : blocked ? { disabled: WAITING } : working ? { disabled: RUNNING } : {}),
    });
    if (row.status.kind === "snoozed" && row.snoozedUntil !== undefined) {
      items.push({ id: "snooze", label: `Wake now · ${wakeLabel(row.snoozedUntil, now.getTime())}`, systemImage: "arrow.uturn.backward", verb: { kind: "snooze", until: null } });
    } else {
      items.push({
        id: "snooze",
        label: "Snooze",
        systemImage: "moon.zzz",
        ...(blocked ? { disabled: WAITING } : {}),
        children: snoozePresets(now).map((preset) => ({ id: `snooze-${preset.id}`, label: `${preset.label} · ${preset.when}`, systemImage: "moon.zzz", verb: { kind: "snooze", until: preset.until } })),
      });
    }
  }
  const over = row.archived ? { disabled: ARCHIVED } : {};
  items.push({ id: "rename", label: "Rename", systemImage: "pencil", verb: { kind: "rename" }, ...over });
  items.push({ id: "regenerate-title", label: "Regenerate title", systemImage: "sparkles", verb: { kind: "regenerate-title" }, ...over });
  const copies: RowMenuItem[] = [];
  if (row.path) copies.push({ id: "copy-path", label: "Path", systemImage: "folder", verb: { kind: "copy", text: row.path } });
  if (row.branch) copies.push({ id: "copy-branch", label: "Branch", systemImage: "arrow.triangle.branch", verb: { kind: "copy", text: row.branch } });
  copies.push({ id: "copy-id", label: "Session ID", systemImage: "number", verb: { kind: "copy", text: row.sessionId } });
  items.push({ id: "copy", label: "Copy", systemImage: "doc.on.doc", children: copies });
  items.push({
    id: "delete",
    label: "Delete session",
    systemImage: "trash",
    destructive: true,
    verb: { kind: "delete" },
    ...(blocked ? { disabled: "A request here is waiting on you. Answer or stop it first." } : working ? { disabled: "A turn is running. Stop it before deleting." } : {}),
  });
  return items;
}
