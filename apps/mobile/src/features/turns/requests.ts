import type { EngineRequest, FileChangeKind } from "@telar/engine-client";

export type RequestCard = {
  id: string;
  symbol: string;
  title: string;
  cwd?: string;
  preview?: { text: string; maxHeight: number };
  note?: string;
  decidable: boolean;
};

const KIND_VERB: Record<FileChangeKind, string> = { create: "Create", edit: "Edit", delete: "Delete", rename: "Rename" };

function pretty(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** `mcp__server__tool` reads as `tool`, as the transcript names it. */
function toolName(name: string): string {
  const parts = name.split("__");
  return name.startsWith("mcp__") && parts.length >= 3 && parts[1] ? parts.slice(2).join("__") : name;
}

/** What an open request asks, with the Swift app's symbol and title for its kind. */
function requestCard(request: EngineRequest): RequestCard {
  const { id, detail } = request;
  switch (detail.kind) {
    case "command_execution":
      return { id, symbol: "terminal", title: "Run a command", ...(detail.command.cwd ? { cwd: detail.command.cwd } : {}), preview: { text: detail.command.command, maxHeight: 80 }, decidable: true };
    case "file_change":
      return { id, symbol: "pencil.line", title: `${KIND_VERB[detail.change.kind]} ${detail.change.path}`, ...(detail.change.unifiedDiff ? { preview: { text: detail.change.unifiedDiff, maxHeight: 160 } } : {}), decidable: true };
    case "file_read":
      return { id, symbol: "doc.text", title: `Read ${detail.read.path}`, decidable: true };
    case "tool_call": {
      const input = pretty(detail.call.input);
      return { id, symbol: "wrench.and.screwdriver", title: toolName(detail.call.name), ...(input ? { preview: { text: input, maxHeight: 160 } } : {}), decidable: true };
    }
    case "user_input":
      return { id, symbol: "questionmark.bubble", title: "Question", note: detail.prompt, decidable: false };
    case "secret_access":
      return { id, symbol: "key.fill", title: "Fill a login", cwd: detail.secret.origin, decidable: false };
  }
}

export function openRequests(requests: readonly EngineRequest[] | undefined): RequestCard[] {
  return (requests ?? []).filter((request) => request.state === "open").map(requestCard);
}
