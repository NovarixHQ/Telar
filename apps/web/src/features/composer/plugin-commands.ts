import type { ComposerCommand } from "./decorations";
import type { Completion } from "./completions";

const PLUGIN_COMMAND_GROUP = "Plugin commands";

const LINE = /^\/([a-z][a-z0-9-]*)(?:[ \t]+([^\n]*))?$/;

export type PluginCommandCall = { command: ComposerCommand; text: string; start: number; end: number };

// With words after the command they are its input and the answer replaces the line; alone on its line, the rest of
// the draft is its input and the answer replaces the whole draft.
export function pluginCommandAt(draft: string, caret: number, commands: readonly ComposerCommand[]): PluginCommandCall | undefined {
  if (commands.length === 0) return undefined;
  const start = draft.lastIndexOf("\n", caret - 1) + 1;
  const newline = draft.indexOf("\n", caret);
  const end = newline === -1 ? draft.length : newline;
  const match = LINE.exec(draft.slice(start, end));
  const command = match && commands.find((candidate) => candidate.name === match[1]);
  if (!match || !command) return undefined;
  const words = match[2]?.trim() ?? "";
  if (words) return { command, text: words, start, end };
  return { command, text: `${draft.slice(0, start)}${draft.slice(end + 1)}`.trim(), start: 0, end: draft.length };
}

export const writingPluginCommand = (query: string, commands: readonly ComposerCommand[]) =>
  /\s/.test(query) && commands.some((command) => query.startsWith(`${command.name} `) || query.startsWith(`${command.name}\t`));

export function pluginCommandCompletions(commands: readonly ComposerCommand[], taken: ReadonlySet<string>): Completion[] {
  return commands
    .filter((command) => !taken.has(command.name))
    .map((command) => ({
      id: `plugin:${command.plugin}:${command.name}`,
      label: `/${command.name}`,
      detail: command.hint ? `${command.description} · ${command.hint}` : command.description,
      glyph: "plugin",
      group: PLUGIN_COMMAND_GROUP,
      action: { type: "insert", text: `/${command.name}` },
    }));
}
