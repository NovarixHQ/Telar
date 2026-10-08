import type { RequestDetail } from "@telar/engine-client";
import { normalizeOutcome, type DriverRequest, type DriverRun } from "../contract";
import { record } from "./items";

type Option = { optionId: string; kind: string };
type Outcome = { outcome: { outcome: "cancelled" } | { outcome: "selected"; optionId: string } };

function requestDetail(toolCall: Record<string, unknown>): RequestDetail {
  const title = typeof toolCall.title === "string" && toolCall.title ? toolCall.title : "Tool call";
  const input = record(toolCall.rawInput);
  const location = record((Array.isArray(toolCall.locations) ? toolCall.locations : [])[0]).path;
  const path = typeof location === "string" ? location : typeof input.path === "string" ? input.path : undefined;
  if (toolCall.kind === "execute") return { kind: "command_execution", command: { command: typeof input.command === "string" ? input.command : title } };
  if ((toolCall.kind === "edit" || toolCall.kind === "delete" || toolCall.kind === "move") && path) {
    return { kind: "file_change", change: { path, kind: toolCall.kind === "delete" ? "delete" : toolCall.kind === "move" ? "rename" : "edit" } };
  }
  if (toolCall.kind === "read" && path) return { kind: "file_read", read: { path } };
  return { kind: "tool_call", call: { name: title, ...(toolCall.rawInput !== undefined ? { input: toolCall.rawInput } : {}) } };
}

const pick = (options: Option[], ...kinds: string[]): string | undefined => kinds.map((kind) => options.find((option) => option.kind === kind)?.optionId).find(Boolean);

export async function answerPermission(params: Record<string, unknown>, gate: DriverRun["onRequest"], signal: AbortSignal): Promise<Outcome> {
  const options = (Array.isArray(params.options) ? params.options : []).map(record).flatMap((option): Option[] =>
    typeof option.optionId === "string" && typeof option.kind === "string" ? [{ optionId: option.optionId, kind: option.kind }] : [],
  );
  const selected = (optionId: string | undefined): Outcome => (optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
  if (!gate) return selected(pick(options, "allow_once", "allow_always"));
  const toolCall = record(params.toolCall);
  const detail = requestDetail(toolCall);
  const request: DriverRequest = { kind: detail.kind, detail, toolUseId: typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : "acp", signal };
  let decision: string;
  try {
    decision = normalizeOutcome(await gate(request)).decision;
  } catch {
    decision = "decline";
  }
  if (signal.aborted) return selected(undefined);
  if (decision === "accept") return selected(pick(options, "allow_once", "allow_always"));
  if (decision === "acceptForSession") return selected(pick(options, "allow_always", "allow_once"));
  if (decision === "decline") return selected(pick(options, "reject_once", "reject_always"));
  return selected(undefined);
}
