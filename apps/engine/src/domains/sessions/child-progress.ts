import type { Item, Turn } from "@telar/engine-client";

const PROGRESS_CHARS = 120;
const TOOL_TYPES: ReadonlySet<Item["detail"]["type"]> = new Set([
  "command_execution",
  "file_change",
  "file_read",
  "mcp_tool_call",
  "dynamic_tool_call",
  "web_search",
  "browser_action",
]);

const clamp = (text: string): string => (text.length <= PROGRESS_CHARS ? text : `${text.slice(0, PROGRESS_CHARS - 1)}…`);

/** One line on what a child's live turn is doing, such as "Edit settings.html · 12 tools"; undefined when nothing runs. */
export function childProgress(live: readonly Turn[], itemsOf: (runId: string) => Item[]): string | undefined {
  const running = live.find((turn) => turn.state === "running" || turn.state === "steering" || turn.state === "claimed");
  if (!running) return live.some((turn) => turn.state === "queued") ? "queued" : undefined;
  const items = itemsOf(running.runId).filter((item) => item.detail.type !== "user_message" && item.detail.type !== "notification");
  const tools = items.filter((item) => TOOL_TYPES.has(item.detail.type)).length;
  const now = items.filter((item) => item.status === "inProgress").at(-1) ?? items.at(-1);
  const doing = now?.title?.split("\n")[0]?.trim() || "working";
  return clamp(tools > 0 ? `${doing} · ${tools} tool${tools === 1 ? "" : "s"}` : doing);
}
