"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ComposerExtensions } from "../decorations";
import { pluginCommandAt } from "../plugin-commands";
import type { ComposerEditorHandle, DecorationFocus } from "../components/composer-editor";

export type PluginCommandState = { running?: string; error?: string };

export function usePluginCommand(editor: RefObject<ComposerEditorHandle | null>, extensions: ComposerExtensions | undefined, draft: string) {
  const [state, setState] = useState<PluginCommandState>({});
  const [focus, setFocus] = useState<DecorationFocus>();
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });
  const commands = extensions?.commands;
  const call = extensions?.call;

  const run = useCallback((): boolean => {
    const found = commands && call ? pluginCommandAt(latest.current, editor.current?.caret() ?? latest.current.length, commands) : undefined;
    if (!found || !call) return false;
    if (state.running) return true;
    const typed = latest.current.slice(found.start, found.end);
    setState({ running: found.command.name });
    call(found.command.plugin, found.command.verb, found.text).then(
      (answer) => {
        const now = latest.current;
        const start = now.slice(found.start, found.end) === typed ? found.start : now.indexOf(typed);
        if (start < 0) return setState({ error: `The draft changed while /${found.command.name} ran, so its answer was not inserted.` });
        editor.current?.replaceRange(start, start + typed.length, answer, false);
        setState({});
      },
      (error: unknown) => setState({ error: `/${found.command.name}: ${error instanceof Error ? error.message : String(error)}` }),
    );
    return true;
  }, [commands, call, editor, state.running]);

  const dismiss = useCallback(() => setState({}), []);
  return { ...state, run, dismiss, focus, setFocus };
}
