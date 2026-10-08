import type { NotificationDetail, Turn } from "@telar/engine-client";

/** A one-line notice in the transcript (Swift's NotificationRow, WakeRow, AgentNoticeRow); `body` opens under it. */
export type Notice = { icon: "bell" | "arrow.left.arrow.right"; verb: string; head?: string; extra: string[]; body?: string };

const HEAD_CHARS = 80;

function notificationVerb(kind: string, intent?: string, wakeKind?: string): string {
  if (kind === "peer_message") {
    if (intent === "task") return "A session assigned work";
    if (intent === "blocker") return "A session reported a blocker";
    if (intent === "result") return "A session sent a result";
    return "A session sent a message";
  }
  if (kind === "request" || wakeKind === "request_opened") return "Session asked a question";
  if (wakeKind === "turn_completed") return "Session finished a turn";
  if (wakeKind === "turn_failed") return "Session failed a turn";
  if (wakeKind === "turn_stopped") return "Session was stopped";
  return "Session activity";
}

/** The first non-empty line, without a leading "[kind]" tag, cut to 80 characters. */
function notificationHead(text: string | undefined): string | undefined {
  const line = (text ?? "").split("\n").map((part) => part.trim()).find(Boolean);
  if (!line) return undefined;
  const stripped = line.startsWith("[") && line.includes("]") ? line.slice(line.indexOf("]") + 1).trim() : line;
  if (!stripped) return undefined;
  return stripped.length <= HEAD_CHARS ? stripped : `${stripped.slice(0, HEAD_CHARS - 1)}…`;
}

export function notificationNotice(detail: NotificationDetail, message?: string): Notice {
  const extra: string[] = [];
  if (detail.entries && detail.entries.length > 1) extra.push(`and ${detail.entries.length - 1} more`);
  if (detail.sessionId) extra.push(`session …${detail.sessionId.slice(-6)}`);
  const head = detail.kind === "peer_message" ? notificationHead(message ?? detail.summary) : undefined;
  return { icon: "bell", verb: notificationVerb(detail.kind, detail.intent, detail.wakeKind), ...(head ? { head } : {}), extra, body: detail.body };
}

/** `provider` is set when the provider woke itself; `task` when a background task's ending did it. */
export function wakeNotice(wakeReason: Turn["wakeReason"] | undefined, provider: { task: boolean } | undefined, notice: string | undefined, text: string): Notice {
  const verb = provider ? (provider.task ? "A background task finished." : "The provider resumed on its own.") : notificationVerb(wakeReason?.kind === "request_opened" ? "request" : "wake", undefined, wakeReason?.kind);
  const head = notificationHead(notice) ?? notificationHead(text);
  return { icon: "bell", verb, ...(head && head !== verb ? { head } : {}), extra: [] };
}

export function agentNotice(intent: string | undefined, notice: string | undefined, message: string): Notice {
  const verb = intent ? (intent === "fyi" ? "FYI" : intent[0]!.toUpperCase() + intent.slice(1)) : "Agent message";
  const head = notificationHead(notice) ?? notificationHead(message);
  return { icon: "arrow.left.arrow.right", verb, ...(head ? { head } : {}), extra: [], body: message };
}
