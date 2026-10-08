import type { EngineRequest, FileChangeKind } from "@telar/engine-client";

export type RequestCard = { id: string; title: string; body?: string; mono: boolean; decidable: boolean };

const KIND_VERB: Record<FileChangeKind, string> = { create: "Create", edit: "Edit", delete: "Delete", rename: "Rename" };

function pretty(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** What an open request asks, as the phone shows it above the composer. */
function requestCard(request: EngineRequest): RequestCard {
  const { detail } = request;
  switch (detail.kind) {
    case "command_execution":
      return { id: request.id, title: "Run a command", body: detail.command.cwd ? `${detail.command.command}\nin ${detail.command.cwd}` : detail.command.command, mono: true, decidable: true };
    case "file_change":
      return { id: request.id, title: `${KIND_VERB[detail.change.kind]} ${detail.change.path}`, ...(detail.change.unifiedDiff ? { body: detail.change.unifiedDiff } : {}), mono: true, decidable: true };
    case "file_read":
      return { id: request.id, title: `Read ${detail.read.path}`, mono: true, decidable: true };
    case "tool_call": {
      const input = pretty(detail.call.input);
      return { id: request.id, title: `Use ${detail.call.name}`, ...(input ? { body: input } : {}), mono: true, decidable: true };
    }
    case "user_input":
      return { id: request.id, title: detail.prompt, body: "Answer this one on the computer for now.", mono: false, decidable: false };
    case "secret_access":
      return { id: request.id, title: `Fill a login for ${detail.secret.origin}`, body: "Answer this one on the computer for now.", mono: false, decidable: false };
  }
}

export function openRequests(requests: readonly EngineRequest[] | undefined): RequestCard[] {
  return (requests ?? []).filter((request) => request.state === "open").map(requestCard);
}
