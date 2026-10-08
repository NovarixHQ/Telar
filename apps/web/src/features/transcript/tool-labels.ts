import { displayToolName, isTelarMcpServer, parseToolName } from "@telar/engine-client";
import type { JournalItem } from "@telar/client/journal";
import { toolInputSummary } from "./tool-input-summary";

export type ToolKind = "command" | "read" | "edit" | "search" | "web" | "browser" | "page" | "terminal" | "tools" | "other";

export type ToolWords = { done: string; running: string; kind: ToolKind; subject?: string; file?: string };

type Verb = Omit<ToolWords, "subject" | "file">;

const verb = (done: string, running: string, kind: ToolKind): Verb => ({ done, running, kind });

const BUILT_IN: Record<string, Verb> = {
  bash: verb("Ran command", "Running command", "command"),
  read: verb("Read file", "Reading file", "read"),
  edit: verb("Edited file", "Editing file", "edit"),
  multiedit: verb("Edited file", "Editing file", "edit"),
  write: verb("Edited file", "Editing file", "edit"),
  grep: verb("Searched", "Searching", "search"),
  glob: verb("Searched", "Searching", "search"),
  list: verb("Listed files", "Listing files", "read"),
  webfetch: verb("Fetched", "Fetching", "web"),
  websearch: verb("Searched web", "Searching web", "web"),
  toolsearch: verb("Loaded tools", "Loading tools", "tools"),
  todowrite: verb("Updated todos", "Updating todos", "other"),
  skill: verb("Used skill", "Using skill", "tools"),
};

const TELAR: Record<string, Verb> = {
  display_inline: verb("Showed a page", "Showing a page", "page"),
  display_open: verb("Showed a page", "Showing a page", "page"),
  display_preview: verb("Previewed a page", "Previewing a page", "page"),
  terminal_open: verb("Ran in terminal", "Running in terminal", "terminal"),
  terminal_run: verb("Ran in terminal", "Running in terminal", "terminal"),
  terminal_wait: verb("Waited on terminal", "Waiting on terminal", "terminal"),
  terminal_output: verb("Read terminal", "Reading terminal", "terminal"),
  terminal_list: verb("Listed terminals", "Listing terminals", "terminal"),
  terminal_kill: verb("Closed terminal", "Closing terminal", "terminal"),
};

const field = (input: unknown, ...keys: string[]): string | undefined => {
  if (!input || typeof input !== "object") return undefined;
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const firstLine = (text: string | undefined) => text?.split(/\r?\n/).find((line) => line.trim())?.trim();

/** `browser_tabs` → `Browser tabs`, `createIssue` → `Create issue`. */
function humanName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function host(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function loadedTools(query: string | undefined): string | undefined {
  if (!query?.startsWith("select:")) return query;
  return query.slice("select:".length).split(",").map((name) => displayToolName(name.trim())).filter(Boolean).join(", ");
}

const words = (base: Verb, subject?: string, file?: string): ToolWords => ({ ...base, ...(subject ? { subject } : {}), ...(file ? { file } : {}) });

function builtIn(name: string, input: unknown): ToolWords | undefined {
  const key = name.toLowerCase();
  const base = BUILT_IN[key];
  if (!base) return undefined;
  switch (key) {
    case "bash":
      return words(base, firstLine(field(input, "command")));
    case "read":
    case "edit":
    case "multiedit":
    case "write":
      return words(base, undefined, field(input, "file_path", "filePath", "path"));
    case "grep":
    case "glob":
      return words(base, field(input, "pattern"));
    case "list":
      return words(base, field(input, "path"));
    case "webfetch":
      return words(base, field(input, "url"));
    case "websearch":
      return words(base, field(input, "query"));
    case "toolsearch":
      return words(base, loadedTools(field(input, "query")));
    case "skill":
      return words(base, field(input, "skill", "name"));
    default:
      return words(base);
  }
}

/** The human verb and subject for a tool call row; nothing for rows that are not calls. */
export function toolWords(item: JournalItem): ToolWords | undefined {
  const detail = item.detail;
  if (detail.type === "browser_action") {
    const { tool } = parseToolName(detail.call.name);
    const where = host(detail.url ?? field(detail.call.input, "url"));
    return words(verb("Browsed", "Browsing", "browser"), where ?? humanName(tool.replace(/^browser_/, "")));
  }
  if (detail.type !== "mcp_tool_call" && detail.type !== "dynamic_tool_call") return undefined;
  const { name, input } = detail.call;
  const parsed = parseToolName(name);
  if (!parsed.server) return builtIn(name, input);
  const telar = isTelarMcpServer(parsed.server);
  const known = telar ? TELAR[parsed.tool] : undefined;
  if (known?.kind === "page") return words(known, field(input, "title"));
  if (known?.kind === "terminal") return words(known, firstLine(field(input, "command", "pattern")));
  if (known) return words(known);
  if (telar && parsed.tool.startsWith("sessions_")) {
    const label = humanName(parsed.tool);
    return words(verb(label, label, "other"), parsed.tool === "sessions_send" ? firstLine(field(input, "input", "message")) : undefined);
  }
  const label = telar ? humanName(parsed.tool) : `${humanName(parsed.server)} · ${humanName(parsed.tool)}`;
  return words(verb(label, label, "other"), toolInputSummary(input));
}

/** What a call was handed, as the expanded row shows it: the raw command, or its input as JSON. */
export function toolInput(item: JournalItem): string | undefined {
  const detail = item.detail;
  if (detail.type === "command_execution") return detail.command.command || undefined;
  if (detail.type !== "mcp_tool_call" && detail.type !== "dynamic_tool_call" && detail.type !== "browser_action") return undefined;
  const { input } = detail.call;
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return input || undefined;
  return typeof input === "object" && Object.keys(input).length === 0 ? undefined : JSON.stringify(input, null, 2);
}
