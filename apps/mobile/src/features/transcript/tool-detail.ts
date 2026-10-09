import { toolOutput, type JournalItem } from "@telar/client/journal";

/** What a tool's detail sheet shows, top to bottom (Swift's ToolDetailSheet). */
export type DetailPart =
  | { kind: "caption"; text: string }
  | { kind: "label"; text: string }
  | { kind: "meta"; text: string; failed?: boolean }
  | { kind: "path"; text: string }
  | { kind: "body"; text: string }
  | { kind: "code"; text: string };

const pretty = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/** The output a row carries: the streamed text while it runs, else what the engine stored. */
function outputOf(item: JournalItem): string | undefined {
  const output = item.streamedText || toolOutput(item);
  return output ? output : undefined;
}

export function detailParts(item: JournalItem): DetailPart[] {
  const parts: DetailPart[] = [];
  const { detail } = item;
  switch (detail.type) {
    case "command_execution":
      if (detail.command.cwd) parts.push({ kind: "caption", text: detail.command.cwd });
      parts.push({ kind: "code", text: detail.command.command });
      if (detail.command.exitCode !== undefined) parts.push({ kind: "meta", text: `exit ${detail.command.exitCode}`, failed: detail.command.exitCode !== 0 });
      break;
    case "file_change":
      parts.push({ kind: "meta", text: `${detail.change.kind} · ${detail.change.path}` });
      if (detail.change.unifiedDiff) parts.push({ kind: "code", text: detail.change.unifiedDiff });
      break;
    case "file_read":
      parts.push({ kind: "path", text: detail.read.path });
      break;
    case "mcp_tool_call":
    case "dynamic_tool_call":
    case "browser_action":
      if (detail.call.input !== undefined) parts.push({ kind: "label", text: "Input" }, { kind: "code", text: pretty(detail.call.input) });
      break;
    case "web_search":
      parts.push({ kind: "body", text: detail.query });
      if (detail.resultCount !== undefined) parts.push({ kind: "meta", text: `${detail.resultCount} results` });
      break;
    default:
      break;
  }
  const output = outputOf(item);
  if (output) parts.push({ kind: "label", text: "Output" }, { kind: "code", text: output });
  return parts;
}

/** What a tool row's long-press menu can copy (Swift's rowCommand, rowBody and rowPath). */
export function rowCopies(item: JournalItem): { label: string; text: string }[] {
  const { detail } = item;
  const copies: { label: string; text: string }[] = [];
  if (detail.type === "command_execution" && detail.command.command) copies.push({ label: "Copy command", text: detail.command.command });
  if (detail.type === "file_change" && detail.change.unifiedDiff) copies.push({ label: "Copy patch", text: detail.change.unifiedDiff });
  else {
    const output = outputOf(item);
    if (output) copies.push({ label: "Copy output", text: output });
  }
  const path = rowPath(item);
  if (path) copies.push({ label: "Copy path", text: path });
  return copies;
}

/** The file a tool row touched, for Copy path and Insert as reference. */
export function rowPath({ detail }: JournalItem): string | undefined {
  return detail.type === "file_change" ? detail.change.path : detail.type === "file_read" ? detail.read.path : undefined;
}

/** The file the editor can open from a row: anything read or changed, except a deleted file. */
export function openablePath(item: JournalItem): string | undefined {
  return item.detail.type === "file_change" && item.detail.change.kind === "delete" ? undefined : rowPath(item);
}
