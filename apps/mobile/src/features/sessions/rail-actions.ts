import type { HostConnection } from "../../platform/connection";
import type { RailRow } from "./rail";

type SessionPatch = Parameters<HostConnection["client"]["updateSession"]>[1];

export type RailAction =
  | { kind: "new-session"; projectId: string; baseRef?: string }
  | { kind: "pin"; pinned: boolean }
  | { kind: "settle"; settled: boolean }
  | { kind: "snooze"; until: number }
  | { kind: "wake" }
  | { kind: "rename"; title: string }
  | { kind: "regenerate-title" }
  | { kind: "copy"; text: string }
  | { kind: "delete" };

/** What the engine is asked for; the rest of the actions stay on the phone. */
export type RailRequest = { kind: "patch"; patch: SessionPatch } | { kind: "regenerate-title" } | { kind: "delete" };

export function requestFor(action: RailAction): RailRequest | undefined {
  switch (action.kind) {
    case "pin":
      return { kind: "patch", patch: { settledOverride: action.pinned ? "active" : null } };
    case "settle":
      return { kind: "patch", patch: { settledOverride: action.settled ? "settled" : "active" } };
    case "snooze":
      return { kind: "patch", patch: { snoozedUntil: action.until } };
    case "wake":
      return { kind: "patch", patch: { settledOverride: "active", snoozedUntil: null } };
    case "rename":
      return { kind: "patch", patch: { title: action.title } };
    case "regenerate-title":
    case "delete":
      return { kind: action.kind };
    default:
      return undefined;
  }
}

export async function sendRailRequest(host: HostConnection, sessionId: string, request: RailRequest): Promise<void> {
  switch (request.kind) {
    case "patch":
      await host.call(false, () => host.client.updateSession(sessionId, request.patch));
      return;
    case "regenerate-title":
      await host.call(false, () => host.client.regenerateSessionTitle(sessionId));
      return;
    case "delete":
      await host.call(false, () => host.client.deleteSession(sessionId));
  }
}

export type SnoozePreset = { id: "hour" | "three-hours" | "evening" | "tomorrow" | "next-week"; label: string; when: string; until: number };

const HOUR = 3_600_000;
const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const atHour = (base: Date, hour: number, addDays = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, hour);

/** In 1 hour, in 3 hours, this evening (while more than an hour away), tomorrow at 9 and next Monday at 9, in local time. */
export function snoozePresets(now: Date): SnoozePreset[] {
  const preset = (id: SnoozePreset["id"], label: string, at: Date, when = time(at)): SnoozePreset => ({ id, label, when, until: at.getTime() });
  const evening = atHour(now, 18);
  const nextWeek = atHour(now, 9, (1 - now.getDay() + 7) % 7 || 7);
  return [
    preset("hour", "In 1 hour", new Date(now.getTime() + HOUR)),
    preset("three-hours", "In 3 hours", new Date(now.getTime() + 3 * HOUR)),
    ...(evening.getTime() - now.getTime() > HOUR ? [preset("evening", "This evening", evening)] : []),
    preset("tomorrow", "Tomorrow", atHour(now, 9, 1)),
    preset("next-week", "Next week", nextWeek, `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${time(nextWeek)}`),
  ];
}

/** "45m", "3h", "2d": rounded up, as the Wake now item shows it. */
export function wakeLabel(snoozedUntil: number, now: number): string {
  const remaining = snoozedUntil - now;
  if (remaining <= 0) return "now";
  if (remaining < HOUR) return `${Math.max(1, Math.ceil(remaining / 60_000))}m`;
  if (remaining < 24 * HOUR) return `${Math.ceil(remaining / HOUR)}h`;
  return `${Math.ceil(remaining / (24 * HOUR))}d`;
}

export type RowMenuItem = { id: string; label: string; systemImage: string; detail?: string; disabled?: string; destructive?: boolean; action?: RailAction; children?: RowMenuItem[] };

const WAITING = "Something here is waiting on you.";
const RUNNING = "A turn is running here.";
const ARCHIVED = "This conversation is over.";

const working = (row: RailRow) => row.activity === "working" || row.activity === "queued";

function deleteRefusal(row: RailRow): string | undefined {
  if (row.activity === "blocked") return "A request here is waiting on you. Answer or stop it first.";
  return working(row) ? "A turn is running. Stop it before deleting." : undefined;
}

/** The row's long-press menu, item for item with the Swift app's. `shelf` is where the row is drawn; `link` its cockpit address. */
export function rowMenu(row: RailRow, options: { shelf?: "snoozed" | "settled"; link?: string; now: Date }): RowMenuItem[] {
  const items: RowMenuItem[] = [
    {
      id: "new-session",
      label: row.branch ? `New session on ${row.branch}` : `New session in ${row.projectName ?? "this project"}`,
      systemImage: "square.and.pencil",
      ...(row.projectId ? { action: { kind: "new-session", projectId: row.projectId, ...(row.branch ? { baseRef: row.branch } : {}) } } : { disabled: "This session belongs to no project." }),
    },
  ];
  if (!row.archived) {
    const settled = options.shelf === "settled";
    const refusal = row.activity === "blocked" ? WAITING : working(row) ? RUNNING : undefined;
    items.push(
      { id: "pin", label: row.pinned ? "Unpin" : "Pin to the list", systemImage: row.pinned ? "pin.slash" : "pin", action: { kind: "pin", pinned: !row.pinned } },
      { id: "settle", label: settled ? "Un-settle" : "Settle", systemImage: settled ? "arrow.uturn.backward" : "checkmark", action: { kind: "settle", settled: !settled }, ...(!settled && refusal ? { disabled: refusal } : {}) },
    );
    const now = options.now.getTime();
    if (row.status.kind === "snoozed" && row.snoozedUntil !== undefined) {
      items.push({ id: "snooze", label: "Wake now", systemImage: "arrow.uturn.backward", detail: wakeLabel(row.snoozedUntil, now), action: { kind: "wake" } });
    } else {
      items.push({
        id: "snooze",
        label: "Snooze",
        systemImage: "moon.zzz",
        ...(row.activity === "blocked" ? { disabled: WAITING } : {}),
        children: snoozePresets(options.now).map((preset) => ({ id: `snooze-${preset.id}`, label: preset.label, systemImage: "moon.zzz", detail: preset.when, action: { kind: "snooze", until: preset.until } })),
      });
    }
  }
  const over = row.archived ? { disabled: ARCHIVED } : {};
  items.push(
    { id: "rename", label: "Rename", systemImage: "pencil", ...over, action: { kind: "rename", title: row.title } },
    { id: "regenerate-title", label: "Regenerate title", systemImage: "sparkles", ...over, action: { kind: "regenerate-title" } },
    {
      id: "copy",
      label: "Copy",
      systemImage: "doc.on.doc",
      children: [
        ...(options.link ? [{ id: "copy-link", label: "Link", systemImage: "link", action: { kind: "copy", text: options.link } } as const] : []),
        ...(row.path ? [{ id: "copy-path", label: "Path", systemImage: "folder", action: { kind: "copy", text: row.path } } as const] : []),
        ...(row.branch ? [{ id: "copy-branch", label: "Branch", systemImage: "arrow.triangle.branch", action: { kind: "copy", text: row.branch } } as const] : []),
        { id: "copy-id", label: "Session ID", systemImage: "number", action: { kind: "copy", text: row.sessionId } },
      ],
    },
    { id: "delete", label: "Delete session", systemImage: "trash", destructive: true, action: { kind: "delete" }, ...(deleteRefusal(row) ? { disabled: deleteRefusal(row)! } : {}) },
  );
  return items;
}

/** The cockpit's address for a session, as Copy ▸ Link puts it on the clipboard. */
export function cockpitLink(base: string, row: Pick<RailRow, "projectId" | "sessionId">): string {
  const root = base.replace(/\/+$/, "");
  return row.projectId ? `${root}/projects/${encodeURIComponent(row.projectId)}/sessions/${encodeURIComponent(row.sessionId)}` : root;
}
