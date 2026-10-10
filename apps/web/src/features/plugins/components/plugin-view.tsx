"use client";

import { usePluginView, type PluginViewScope } from "../hooks/use-plugin-view";
import { PluginBlocks } from "./panel-blocks";

/** One plugin view drawn from its blocks, in whichever scope answers it. */
export function PluginView({
  scope,
  plugin,
  verb,
  refreshKey,
  onOpenFile,
  onPrompt,
}: {
  scope: PluginViewScope | undefined;
  plugin: string;
  verb: string;
  refreshKey?: unknown;
  onOpenFile?: (path: string) => void;
  /** Where a `prompt` block's text goes; without it the button is disabled. */
  onPrompt?: (text: string) => void;
}) {
  const { state, pending, failure, call } = usePluginView(scope, plugin, verb, refreshKey);
  return (
    <>
      {failure && <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">{failure}</p>}
      {state.status === "loading" && <p className="text-xs text-muted-foreground">Loading…</p>}
      {state.status === "failed" && <p className="text-xs text-destructive">{state.error}</p>}
      {state.status === "ready" && (
        <PluginBlocks
          blocks={state.view.blocks}
          {...(pending !== undefined ? { pending } : {})}
          onCall={(target, index) => void call(target, index)}
          {...(onOpenFile ? { onOpenFile } : {})}
          {...(onPrompt ? { onPrompt } : {})}
        />
      )}
    </>
  );
}
