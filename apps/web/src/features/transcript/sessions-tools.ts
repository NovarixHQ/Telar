import { displayToolName } from "@telar/engine-client";
import type { JournalItem } from "@/platform/engine";

type Wording = { running: string; done: string; many: (count: number) => string };

const plural = (verb: string, noun: string) => (count: number) => `${verb} ${count} ${noun}`;

const SEND: Record<string, Wording> = {
  task: { running: "Tasking a session", done: "Tasked a session", many: plural("Tasked", "sessions") },
  result: { running: "Sending a result", done: "Sent a result", many: plural("Sent", "results") },
  blocker: { running: "Raising a blocker", done: "Raised a blocker", many: plural("Raised", "blockers") },
  fyi: { running: "Sending a note", done: "Sent a note", many: plural("Sent", "notes") },
};

const FIXED: Record<string, Wording> = {
  sessions_read: { running: "Reading a session", done: "Read a session", many: plural("Read", "sessions") },
  sessions_list: { running: "Listing sessions", done: "Listed sessions", many: () => "Listed sessions" },
  sessions_stop: { running: "Stopping a session", done: "Stopped a session", many: plural("Stopped", "sessions") },
  sessions_settle: { running: "Settling a session", done: "Settled a session", many: plural("Settled", "sessions") },
  sessions_subscribe: { running: "Subscribing to a session", done: "Subscribed to a session", many: plural("Subscribed to", "sessions") },
};

const callOf = (item: JournalItem) => (item.detail.type === "mcp_tool_call" || item.detail.type === "dynamic_tool_call" ? item.detail.call : undefined);

const field = (value: unknown, key: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined);

function wording(item: JournalItem): { key: string; words: Wording; title?: string } | undefined {
  const call = callOf(item);
  if (!call) return undefined;
  const tool = displayToolName(call.name);
  if (tool === "sessions_create") {
    const raw = field(call.input, "title");
    const title = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
    const words: Wording = title
      ? { running: `Starting builder “${title}”`, done: `Started builder “${title}”`, many: plural("Started", "builders") }
      : { running: "Starting a builder", done: "Started a builder", many: plural("Started", "builders") };
    return { key: tool, words, ...(title ? { title } : {}) };
  }
  if (tool === "sessions_send") {
    const given = String(field(call.input, "intent") ?? "fyi");
    const intent = Object.hasOwn(SEND, given) ? given : "fyi";
    return { key: `${tool}:${intent}`, words: SEND[intent]! };
  }
  const words = FIXED[tool];
  return words ? { key: tool, words } : undefined;
}

/** A sessions tool call read as what the agent did, in the row's tense; nothing for any other row. */
export function sessionsActionLabel(item: JournalItem, running: boolean): string | undefined {
  const found = wording(item);
  return found && (running ? found.words.running : found.words.done);
}

export function sessionsLabelSaysAll(item: JournalItem): boolean {
  return wording(item)?.title !== undefined;
}

export function sessionsTally(item: JournalItem): { key: string; label: (count: number) => string } | undefined {
  const found = wording(item);
  return found && { key: found.key, label: (count) => (count === 1 ? found.words.done : found.words.many(count)) };
}

function parsed(output: unknown): unknown {
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return undefined;
    }
  }
  const content = field(output, "content");
  if (Array.isArray(content)) return parsed(content.map((part) => field(part, "text")).find((text) => typeof text === "string"));
  return output;
}

export function sessionsLink(item: JournalItem): string | undefined {
  const call = callOf(item);
  if (!call || item.status === "inProgress" || !displayToolName(call.name).startsWith("sessions_")) return undefined;
  const link = field(parsed(call.output), "link");
  return typeof link === "string" && link.startsWith("/projects/") ? link : undefined;
}
