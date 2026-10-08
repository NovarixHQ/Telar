import { displayToolName } from "@telar/engine-client";
import { isActiveTurn, isCompacting, itemLabel, itemText, type JournalItem, type JournalTask, type JournalTurn } from "@telar/client/journal";
import { agentNotice, notificationNotice, wakeNotice, type Notice } from "./notices";

/** A run of steps drawn as one fold: live shows "+N earlier steps" over the newest, settled shows "N steps · tally". */
export type Fold = { kind: "fold"; id: string; items: JournalItem[]; live: boolean; failed: boolean; tally: string };
export type Activity = { kind: "item"; item: JournalItem } | Fold;

type Opener = { kind: "bubble"; text: string; attachments: number } | { kind: "notice"; notice: Notice } | { kind: "compact"; text: string };

export type Ending = { kind: "working"; label: "Working" | "Queued" | "Compacting context" } | { kind: "failed"; text: string } | { kind: "stopped" };

export type TurnLayout = { runId: string; opener?: Opener; body: Activity[]; ending?: Ending };


const DRIVER: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode", telar: "Telar" };
type SwitchSide = { driver: string; model?: string | undefined };
const side = ({ driver, model }: SwitchSide) => (model ? `${DRIVER[driver] ?? driver} · ${model}` : (DRIVER[driver] ?? driver));

export function providerSwitchLabel({ from, to, carriedTurns }: { from: SwitchSide; to: SwitchSide; carriedTurns: number }): string {
  const carried = carriedTurns === 0 ? "" : carriedTurns === 1 ? " · 1 turn carried" : ` · ${carriedTurns} turns carried`;
  return `Switched from ${side(from)} to ${side(to)}${carried}`;
}

// Rows that interrupt a run of steps instead of folding into it.
const BREAKS_RUN = new Set(["assistant_message", "user_message", "plan", "context_compaction", "provider_switch", "artifact"]);

const liveTask = (item: JournalItem, tasks: readonly JournalTask[]) =>
  item.detail.type === "task" && ["pending", "running", "waiting"].includes(tasks.find((task) => task.id === (item.detail as { taskId: string }).taskId)?.state ?? "");

function failed(item: JournalItem, tasks: readonly JournalTask[]): boolean {
  if (item.status === "failed") return true;
  const { detail } = item;
  return detail.type === "task" && tasks.find((task) => task.id === detail.taskId)?.state === "failed";
}

function tallyLabel(item: JournalItem): string {
  const { detail } = item;
  switch (detail.type) {
    case "assistant_message": return "Narrated";
    case "command_execution": return "Ran command";
    case "file_change": return "Edited file";
    case "file_read": return "Read file";
    case "web_search": return "Searched";
    case "browser_action": return "Browser";
    case "reasoning": return "Thought";
    case "notification": return "Notified";
    case "user_message": return detail.wakeReason ? "Woken" : detail.sender ? "Agent message" : "You steered";
    case "task": return "Delegated";
    case "error": return "Error";
    case "plan": return "Planned";
    case "context_compaction": return "Compacted context";
    case "provider_switch": return providerSwitchLabel(detail);
    case "mcp_tool_call":
    case "dynamic_tool_call": return displayToolName(detail.call.name);
    default: return itemLabel(item);
  }
}

/** "Ran command ×3 · Edited file", in first-seen order. */
function tally(items: readonly JournalItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(tallyLabel(item), (counts.get(tallyLabel(item)) ?? 0) + 1);
  return [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(" · ");
}

const fold = (items: JournalItem[], live: boolean, tasks: readonly JournalTask[]): Fold => ({
  kind: "fold", id: items[0]!.id, items, live, failed: items.some((item) => failed(item, tasks)), tally: tally(items),
});

// A live sub-agent and an artifact stand on their own; everything else between them folds.
function group(items: readonly JournalItem[], tasks: readonly JournalTask[], live: boolean): Activity[] {
  const rows = items.filter((item) => item.detail.type !== "reasoning" || itemText(item).trim());
  const cuts: (JournalItem | JournalItem[])[] = [];
  for (const item of rows) {
    if (liveTask(item, tasks) || item.detail.type === "artifact") cuts.push(item);
    else if (Array.isArray(cuts.at(-1))) (cuts.at(-1) as JournalItem[]).push(item);
    else cuts.push([item]);
  }
  const lastRun = cuts.findLastIndex(Array.isArray);
  return cuts.map((cut, index) => (Array.isArray(cut) ? fold(cut, live && index === lastRun, tasks) : { kind: "item", item: cut }));
}

function segments(items: readonly JournalItem[], tasks: readonly JournalTask[], liveTail: boolean): Activity[] {
  const parts: (JournalItem | JournalItem[])[] = [];
  for (const item of items) {
    if (BREAKS_RUN.has(item.detail.type)) parts.push(item);
    else if (Array.isArray(parts.at(-1))) (parts.at(-1) as JournalItem[]).push(item);
    else parts.push([item]);
  }
  return parts.flatMap((part, index) => (Array.isArray(part) ? group(part, tasks, liveTail && index === parts.length - 1) : [{ kind: "item" as const, item: part }]));
}

function compactTurn(turn: JournalTurn): TurnLayout {
  const compactions = turn.items.filter((item) => item.detail.type === "context_compaction");
  if (compactions.length) return { runId: turn.runId, body: compactions.map((item) => ({ kind: "item", item })) };
  const text = isActiveTurn(turn.state) ? "Compacting context…" : turn.state === "failed" ? "Compaction failed" : "Context compaction requested";
  return { runId: turn.runId, opener: { kind: "compact", text }, body: [] };
}

function opener(turn: JournalTurn): Opener {
  if (turn.notification) return { kind: "notice", notice: notificationNotice(turn.notification, turn.sender ? turn.prompt : undefined) };
  if (turn.wakeReason || turn.origin === "provider") return { kind: "notice", notice: wakeNotice(turn.wakeReason, turn.origin === "provider" ? { task: Boolean(turn.wokenBy) } : undefined, turn.agentNotice, turn.prompt) };
  if (turn.sender) return { kind: "notice", notice: agentNotice(turn.agentIntent, turn.agentNotice, turn.prompt) };
  return { kind: "bubble", text: turn.prompt, attachments: turn.attachments?.length ?? 0 };
}

function ending(turn: JournalTurn): Ending | undefined {
  if (turn.state === "failed") return { kind: "failed", text: turn.failure ?? "Turn failed" };
  if (turn.state === "stopped") return { kind: "stopped" };
  if (!isActiveTurn(turn.state) && turn.state !== "steering") return undefined;
  return { kind: "working", label: isCompacting(turn) ? "Compacting context" : turn.state === "queued" ? "Queued" : "Working" };
}

const ownNotification = (turn: JournalTurn) => (turn.notification && (turn.origin === "session" || turn.origin === "provider") ? `notification_${turn.runId}` : undefined);

// A notification that woke the session and produced nothing: drawn as one line, stacked with the next.
function bareNotification(turn: JournalTurn): boolean {
  if (!turn.notification || turn.items.some((item) => item.id !== ownNotification(turn))) return false;
  if (turn.resultText || turn.failure || turn.usage || isActiveTurn(turn.state)) return false;
  return turn.state !== "failed" && turn.state !== "stopped" && turn.state !== "discarded";
}

/** Runs of bare notification turns sit 2pt apart instead of a turn's 16pt, as in the Swift transcript. */
export function groupTurns(turns: readonly JournalTurn[]): JournalTurn[][] {
  const groups: JournalTurn[][] = [];
  for (const turn of turns) {
    const previous = groups.at(-1)?.at(-1);
    if (previous && turn.notification && bareNotification(previous)) groups.at(-1)!.push(turn);
    else groups.push([turn]);
  }
  return groups;
}

/** One turn as the Swift app draws it: earlier responses as segments, the answer's steps folded above its closing prose. */
export function turnLayout(turn: JournalTurn): TurnLayout {
  if (turn.kind === "compact") return compactTurn(turn);
  const own = ownNotification(turn);
  const items = turn.items.filter((item) => item.id !== own);
  const responses: { boundary?: JournalItem; items: JournalItem[] }[] = [{ items: [] }];
  for (const item of items) {
    if (item.detail.type === "user_message" || item.detail.type === "notification") responses.push({ boundary: item, items: [] });
    else responses.at(-1)!.items.push(item);
  }
  if (responses.length > 1 && responses[0]!.items.length === 0) responses.shift();

  const body: Activity[] = [];
  const answering = responses.pop()!;
  for (const response of responses) {
    if (response.boundary) body.push({ kind: "item", item: response.boundary });
    body.push(...segments(response.items, turn.tasks, false));
  }
  if (answering.boundary) body.push({ kind: "item", item: answering.boundary });
  if (isActiveTurn(turn.state) || turn.state === "steering") {
    body.push(...segments(answering.items, turn.tasks, true));
  } else {
    const lastProse = answering.items.findLastIndex((item) => item.detail.type === "assistant_message");
    const cut = lastProse < 0 ? answering.items.length : lastProse;
    body.push(...group(answering.items.slice(0, cut), turn.tasks, false));
    body.push(...answering.items.slice(cut).map((item) => ({ kind: "item" as const, item })));
  }
  const end = ending(turn);
  return { runId: turn.runId, opener: opener(turn), body, ...(end ? { ending: end } : {}) };
}
