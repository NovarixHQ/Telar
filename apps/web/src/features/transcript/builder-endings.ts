import type { NotificationDetail, NotificationEntry, SessionChildState } from "@telar/engine-client";

export type BuilderEnding = { sessionId: string; state: Extract<SessionChildState, "done" | "failed" | "stopped">; title?: string; summary?: string };

const TAG = "[builder ";

function ending(entry: NotificationEntry): BuilderEnding | undefined {
  const sessionId = entry.sessionId;
  if (entry.kind !== "wake" || !sessionId || !entry.summary.startsWith(TAG)) return undefined;
  const state = entry.wakeKind === "turn_failed" ? "failed" : entry.wakeKind === "turn_stopped" ? "stopped" : "done";
  const marker = `(${sessionId}) — `;
  const at = entry.summary.indexOf(marker);
  const summary = at < 0 ? "" : entry.summary.slice(at + marker.length).split(" · read it with")[0]!.trim();
  return { sessionId, state, ...(entry.title ? { title: entry.title } : {}), ...(summary ? { summary } : {}) };
}

export function builderEndings(detail: NotificationDetail): BuilderEnding[] | undefined {
  const entries: NotificationEntry[] = detail.entries?.length ? detail.entries : [detail];
  const endings = entries.map(ending);
  return endings.every((each) => each !== undefined) ? endings : undefined;
}

export type AgentFinished = { sessionIds: string[]; titles: (string | undefined)[]; failed: boolean };

export function agentsFinished(detail: NotificationDetail, isChild: (sessionId: string) => boolean): AgentFinished | undefined {
  const entries: NotificationEntry[] = detail.entries?.length ? detail.entries : [detail];
  const ended = (entry: NotificationEntry) => entry.wakeKind === "turn_completed" || entry.wakeKind === "turn_failed";
  const finished = entries.every((entry) => entry.sessionId && ((entry.kind === "wake" && ended(entry) && entry.summary.startsWith(TAG)) || ((entry.intent === "result" || ended(entry)) && isChild(entry.sessionId))));
  if (!finished) return undefined;
  return { sessionIds: entries.map((entry) => entry.sessionId!), titles: entries.map((entry) => entry.title), failed: entries.some((entry) => entry.wakeKind === "turn_failed") };
}
