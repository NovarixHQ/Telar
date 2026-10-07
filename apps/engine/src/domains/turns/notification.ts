import type { NotificationDetail, NotificationEntry, SessionChildState, WakeKind } from "@telar/engine-client";
import { agentNotice, type AgentNoticeInput } from "./agent-notice";
import { firstLine } from "./turn-summary";

const SUMMARY_CHARS = 240;

const ENTRY_CHARS = 1_000;

export const MAX_ENTRIES = 50;

export const MAX_DELIVERIES = 2;

const summaryOf = (body: string) => firstLine(body, SUMMARY_CHARS);

function kindOf(wake: WakeKind): "wake" | "request" {
  return wake === "request_opened" ? "request" : "wake";
}

export function peerNotification(input: AgentNoticeInput): NotificationDetail {
  const body = agentNotice(input);
  return {
    kind: "peer_message",
    ...(input.sender?.sessionId ? { sessionId: input.sender.sessionId } : {}),
    runId: input.runId,
    intent: input.intent,
    ...(input.spent ? { spent: input.spent } : {}),
    summary: summaryOf(body),
    fetch: { sessionId: input.recipientSessionId, runId: input.runId },
    body,
  };
}

export function wakeNotification(input: {
  wakeKind: WakeKind;
  targetSessionId: string;
  runId: string;
  requestId?: string;
  body: string;
}): NotificationDetail {
  return {
    kind: kindOf(input.wakeKind),
    sessionId: input.targetSessionId,
    runId: input.runId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    wakeKind: input.wakeKind,
    summary: summaryOf(input.body),
    fetch: { sessionId: input.targetSessionId, runId: input.runId },
    body: input.body,
  };
}

function asEntry(detail: NotificationDetail): NotificationEntry {
  return {
    kind: detail.kind,
    ...(detail.sessionId ? { sessionId: detail.sessionId } : {}),
    ...(detail.runId ? { runId: detail.runId } : {}),
    ...(detail.requestId ? { requestId: detail.requestId } : {}),
    ...(detail.wakeKind ? { wakeKind: detail.wakeKind } : {}),
    ...(detail.intent ? { intent: detail.intent } : {}),
    summary: detail.summary,
  };
}

export function mergeNotifications(held: NotificationDetail[]): NotificationDetail {
  const newest = held[held.length - 1]!;
  if (held.length === 1) return newest;
  const flat = held.flatMap((detail) => detail.entries ?? [asEntry(detail)]);
  const entries = flat.filter((entry, index) => !flat.slice(index + 1).some((later) => sameHappening(later, entry))).slice(-MAX_ENTRIES);
  if (entries.length === 1) return newest;
  return listed(entries, newest);
}

function listed(entries: NotificationEntry[], newest: NotificationDetail): NotificationDetail {
  if (entries.every(isChildEnding)) return childEndings(entries, newest);
  const body = [
    `[engine notification · ${entries.length} ${entries.length === 1 ? "thing" : "things"} happened while this session was working]`,
    "—",
    ...entries.map((entry, index) => `${index + 1}. ${entry.summary}`),
    "—",
    `Each line above names a session and a run. Read whichever matters with sessions_read(sessionId, runId) — the most recent is ${newest.fetch.sessionId} / ${newest.fetch.runId}. None of this was typed by a person.`,
  ].join("\n");
  return {
    ...newest,
    summary: entries.length === 1 ? newest.summary : `${newest.summary.replace(/ \(and \d+ more\)$/, "")} (and ${entries.length - 1} more)`,
    body,
    entries,
  };
}

export function withoutEntries(detail: NotificationDetail, drops: (entry: NotificationEntry) => boolean, recipientSessionId: string): NotificationDetail | undefined {
  const all = detail.entries ?? [asEntry(detail)];
  const kept = all.filter((entry) => !drops(entry));
  if (kept.length === all.length) return detail;
  if (kept.length === 0) return undefined;
  const newest = kept[kept.length - 1]!;
  const leadIsKept = !drops(asEntry(detail));
  const lead: NotificationDetail = leadIsKept
    ? detail
    : {
        ...newest,
        fetch: { sessionId: newest.kind === "peer_message" ? recipientSessionId : newest.sessionId!, runId: newest.runId! },
        body: "",
      };
  return listed(kept, lead);
}

function sameHappening(a: NotificationEntry, b: NotificationEntry): boolean {
  return a.kind === b.kind && a.sessionId === b.sessionId && a.runId === b.runId;
}

export function mergeRunOutcome(lead: NotificationDetail, ended: NotificationDetail): NotificationDetail {
  const entries = [...(lead.entries ?? [asEntry(lead)]), asEntry(ended)].slice(-MAX_ENTRIES);
  return {
    ...lead,
    summary: `${lead.summary.replace(/ \(and \d+ more\)$/, "")} (and ${entries.length - 1} more)`,
    body: [
      lead.body,
      "—",
      `[and since] ${ended.summary}`,
      "That is TWO things about one run, in one notice: the message above, and the fact that the run it came from has since ended. Nothing was withheld and nothing else arrived.",
    ].join("\n"),
    entries,
  };
}

export function heldDelivery(detail: NotificationDetail): NotificationDetail {
  if (detail.kind !== "peer_message" || detail.entries) return detail;
  return {
    ...detail,
    body: `${detail.body}\nIt arrived while this session was working and was held until now; nothing else is waiting.`,
  };
}

export function notificationLabel(detail: NotificationDetail): string {
  const what = detail.kind === "request" ? "request" : detail.kind === "peer_message" ? "peer message" : "wake";
  const where = detail.sessionId ? ` · session ${detail.sessionId}` : "";
  const which = detail.wakeKind ? ` · ${detail.wakeKind}` : "";
  return `[notification: ${what}${which}${where}]`;
}

const CHILD_WAKE: Record<Exclude<SessionChildState, "working" | "waiting">, WakeKind> = { done: "turn_completed", failed: "turn_failed", stopped: "turn_stopped" };
const CHILD_TAG = "[builder ";

const isChildEnding = (entry: NotificationEntry): boolean => entry.kind === "wake" && entry.summary.startsWith(CHILD_TAG);

const quoted = (title: string | undefined, sessionId: string) => (title ? `"${title}"` : sessionId);

/** A builder's ending as its parent reads it: one line and where to read the rest, never the result itself. */
export function childEndingNotification(input: {
  sessionId: string;
  title?: string;
  state: Exclude<SessionChildState, "working" | "waiting">;
  summary?: string;
  fetch?: { sessionId: string; runId: string };
}): NotificationDetail {
  const fetch = input.fetch ?? { sessionId: input.sessionId, runId: input.sessionId };
  const read = input.fetch ? ` · read it with sessions_read(sessionId: "${fetch.sessionId}", runId: "${fetch.runId}")` : "";
  const line = `${CHILD_TAG}${input.state}] ${quoted(input.title, input.sessionId)} (${input.sessionId})${input.summary ? ` — ${input.summary}` : ""}${read}`;
  const wakeKind = CHILD_WAKE[input.state];
  return {
    kind: "wake",
    sessionId: input.sessionId,
    ...(input.fetch ? { runId: input.fetch.runId } : {}),
    wakeKind,
    summary: summaryOf(line),
    fetch,
    body: line,
    entries: [{ kind: "wake", sessionId: input.sessionId, ...(input.fetch ? { runId: input.fetch.runId } : {}), wakeKind, summary: firstLine(line, ENTRY_CHARS), ...(input.title ? { title: input.title } : {}) }],
  };
}

function childEndings(entries: NotificationEntry[], newest: NotificationDetail): NotificationDetail {
  const outcome = (entry: NotificationEntry) => {
    const state = entry.wakeKind === "turn_failed" ? "failed" : entry.wakeKind === "turn_stopped" ? "stopped" : "done";
    const after = entry.summary.indexOf(`(${entry.sessionId}) — `);
    const rest = after < 0 ? "" : entry.summary.slice(after + `(${entry.sessionId}) — `.length);
    const why = state === "done" ? "" : rest.split(" · read it with")[0];
    return `${quoted(entry.title, entry.sessionId ?? "")} (${state}${why ? `: ${why}` : ""})`;
  };
  const header = `${entries.length} builders finished · ${entries.map(outcome).join(" · ")}. Read any with sessions_read.`;
  return {
    ...newest,
    summary: summaryOf(header),
    body: [header, ...entries.map((entry, index) => `${index + 1}. ${entry.summary}`)].join("\n"),
    entries,
  };
}
