import type { ItemDetail, ItemStatus, PlanStepStatus, TurnObservation, UsageSnapshot } from "@telar/engine-client";

type Emit = (observation: TurnObservation) => void;
type Json = Record<string, unknown>;

export const record = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

const SILENT = new Set(["user_message_chunk", "available_commands_update", "current_mode_update", "config_option_update", "session_info_update"]);

const PLAN_STATUS: Record<string, PlanStepStatus> = { pending: "pending", in_progress: "inProgress", completed: "completed" };

export class AcpTurn {
  text = "";
  private open: { id: string; stream: "assistant_text" | "reasoning_text"; text: string } | undefined;
  private readonly tools = new Map<string, { id: string; detail: ItemDetail; title: string }>();
  private planId: string | undefined;
  private rows = 0;
  private context: { used: number; size: number } | undefined;

  constructor(
    private readonly runKey: string,
    private readonly emit: Emit,
  ) {}

  handle(update: Json): void {
    const kind = text(update.sessionUpdate) ?? "";
    if (kind === "agent_message_chunk") return this.chunk("assistant_text", update.content);
    if (kind === "agent_thought_chunk") return this.chunk("reasoning_text", update.content);
    if (kind === "tool_call" || kind === "tool_call_update") return this.tool(update);
    if (kind === "plan") return this.plan(update.entries);
    if (kind === "usage_update") {
      this.context = { used: count(update.used), size: count(update.size) };
      return;
    }
    if (SILENT.has(kind)) return;
    this.closeText();
    const id = this.mint();
    this.emit({ kind: "item.started", item: { id, detail: { type: "unknown", label: kind || "update", payload: update }, title: kind || "Agent update" } });
    this.emit({ kind: "item.completed", itemId: id, status: "completed" });
  }

  finish(): void {
    this.closeText();
    for (const tool of this.tools.values()) this.emit({ kind: "item.completed", itemId: tool.id, status: "failed" });
    this.tools.clear();
  }

  usage(response: unknown): UsageSnapshot | undefined {
    const usage = record(record(response).usage);
    const tokens = { input: count(usage.inputTokens), output: count(usage.outputTokens), cacheRead: count(usage.cachedReadTokens), cacheCreate: count(usage.cachedWriteTokens) };
    const reasoning = count(usage.thoughtTokens);
    if (tokens.input + tokens.output === 0 && !this.context) return undefined;
    return {
      tokens: { ...tokens, ...(reasoning ? { reasoning } : {}) },
      ...(this.context?.used ? { contextUsed: this.context.used } : {}),
      ...(this.context?.size ? { contextMax: this.context.size } : {}),
    };
  }

  private mint(): string {
    return `acp_${this.runKey}_${++this.rows}`;
  }

  private chunk(stream: "assistant_text" | "reasoning_text", content: unknown): void {
    const block = record(content);
    const delta = block.type === "text" ? text(block.text) : undefined;
    if (!delta) return;
    if (this.open?.stream !== stream) {
      this.closeText();
      const id = this.mint();
      this.open = { id, stream, text: "" };
      this.emit({ kind: "item.started", item: { id, detail: stream === "assistant_text" ? { type: "assistant_message", text: "" } : { type: "reasoning", text: "" } } });
    }
    this.open.text += delta;
    if (stream === "assistant_text") this.text += delta;
    this.emit({ kind: "content.delta", itemId: this.open.id, stream, text: delta });
  }

  private closeText(): void {
    if (!this.open) return;
    const { id, stream, text: body } = this.open;
    this.open = undefined;
    this.emit({ kind: "item.completed", itemId: id, status: "completed", detail: stream === "assistant_text" ? { type: "assistant_message", text: body } : { type: "reasoning", text: body } });
  }

  private tool(update: Json): void {
    const toolCallId = text(update.toolCallId);
    if (!toolCallId) return;
    this.closeText();
    const known = this.tools.get(toolCallId);
    const title = text(update.title) ?? known?.title ?? "Tool call";
    const detail = toolDetail(update, title, known?.detail);
    const status = text(update.status);
    if (!known) {
      const id = this.mint();
      this.tools.set(toolCallId, { id, detail, title });
      this.emit({ kind: "item.started", item: { id, detail, title } });
    } else {
      known.detail = detail;
      known.title = title;
      this.emit({ kind: "item.updated", item: { id: known.id, detail, title } });
    }
    if (status !== "completed" && status !== "failed") return;
    const ended = this.tools.get(toolCallId)!;
    this.tools.delete(toolCallId);
    const itemStatus: ItemStatus = status === "completed" ? "completed" : "failed";
    this.emit({ kind: "item.completed", itemId: ended.id, status: itemStatus, detail });
  }

  private plan(entries: unknown): void {
    const steps = (Array.isArray(entries) ? entries : []).flatMap((entry) => {
      const step = text(record(entry).content);
      return step ? [{ step, status: PLAN_STATUS[text(record(entry).status) ?? ""] ?? "pending" }] : [];
    });
    const detail: ItemDetail = { type: "plan", plan: { steps } };
    if (this.planId) return this.emit({ kind: "item.updated", item: { id: this.planId, detail } });
    this.planId = this.mint();
    this.emit({ kind: "item.started", item: { id: this.planId, detail } });
  }
}

function contentText(content: unknown): string | undefined {
  const parts = (Array.isArray(content) ? content : []).flatMap((entry) => {
    const block = record(record(entry).content);
    return record(entry).type === "content" && block.type === "text" && typeof block.text === "string" ? [block.text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function toolDetail(update: Json, title: string, previous: ItemDetail | undefined): ItemDetail {
  const kind = text(update.kind) ?? (previous ? previousKind(previous) : "other");
  const input = record(update.rawInput);
  const location = text(record((Array.isArray(update.locations) ? update.locations : [])[0]).path);
  const diff = (Array.isArray(update.content) ? update.content : []).map(record).find((entry) => entry.type === "diff");
  const output = update.rawOutput ?? contentText(update.content);
  if (kind === "execute") {
    const command = text(input.command) ?? (previous?.type === "command_execution" ? previous.command.command : title);
    const preview = typeof output === "string" ? output : undefined;
    return { type: "command_execution", command: { command, ...(preview ? { outputPreview: preview } : {}) } };
  }
  const filePath = text(diff?.path) ?? location ?? text(input.path) ?? text(input.file_path);
  if ((kind === "edit" || kind === "delete" || kind === "move") && filePath) {
    return { type: "file_change", change: { path: filePath, kind: kind === "delete" ? "delete" : kind === "move" ? "rename" : diff && diff.oldText == null ? "create" : "edit" } };
  }
  if (kind === "read" && filePath) return { type: "file_read", read: { path: filePath } };
  const previousCall = previous && "call" in previous ? previous.call : undefined;
  return {
    type: "dynamic_tool_call",
    call: {
      name: title,
      ...(update.rawInput !== undefined ? { input: update.rawInput } : previousCall?.input !== undefined ? { input: previousCall.input } : {}),
      ...(output !== undefined ? { output } : {}),
      toolUseId: text(update.toolCallId)!,
    },
  };
}

function previousKind(detail: ItemDetail): string {
  if (detail.type === "command_execution") return "execute";
  if (detail.type === "file_read") return "read";
  if (detail.type === "file_change") return detail.change.kind === "delete" ? "delete" : detail.change.kind === "rename" ? "move" : "edit";
  return "other";
}
