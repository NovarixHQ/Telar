"use client";

import { PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";
import { RunGlyph } from "../run/icons";
import type { RunConfigurationView } from "../run/types";
import type { RunHeader } from "../hooks/use-run-header";
import { RunConfigEditor } from "./run-config-editor";

function RunRow({ header, config }: { header: RunHeader; config: RunConfigurationView }) {
  return (
    <div className="group/run flex items-center gap-1">
      <button
        type="button"
        disabled={header.busy}
        aria-label={`Run ${config.name}`}
        title="Types this command into its idle terminal, or opens a new one"
        onClick={() => header.start(config.id)}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60", header.busy && "opacity-60")}
      >
        <RunGlyph icon={config.icon} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Run {config.name}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Edit ${config.name}`}
        title="Edit"
        disabled={header.busy}
        className="shrink-0 opacity-0 group-hover/run:opacity-70 focus-visible:opacity-100"
        onClick={() => header.setEditing({ config })}
      >
        <SlidersHorizontalIcon />
      </Button>
    </div>
  );
}

export function RunHeaderMenu({ header, onWatchOutput }: { header: RunHeader; onWatchOutput: (() => void) | undefined }) {
  const { configs, error } = header;
  return (
    <>
      <section aria-label="Run a configuration" className="flex min-h-0 max-h-72 flex-col gap-0.5 overflow-y-auto p-1">
        {configs === undefined ? (
          <p className="px-2 py-1.5 text-2xs text-muted-foreground">Reading configurations…</p>
        ) : configs.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs leading-snug text-muted-foreground">No run configuration yet. Add one to give this project a start command.</p>
        ) : (
          configs.map((config) => <RunRow key={config.id} header={header} config={config} />)
        )}
      </section>
      {error && <p className="border-t border-border px-3 py-1.5 text-2xs leading-snug text-destructive">{error}</p>}
      <div className="flex items-center gap-1 border-t border-border p-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => header.setEditing({})}>
          <PlusIcon className="size-3.5" />
          New configuration
        </Button>
        <div className="flex-1" />
        {onWatchOutput && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              header.setOpen(false);
              onWatchOutput();
            }}
          >
            Show terminals
          </Button>
        )}
      </div>
    </>
  );
}

/** The panel's own configuration form, inline. */
export function RunHeaderEditor({ header }: { header: RunHeader }) {
  const { editing, busy, error } = header;
  if (!editing) return null;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <SlidersHorizontalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{editing.config ? `Edit ${editing.config.name}` : "New run configuration"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <RunConfigEditor
          {...(editing.config ? { config: editing.config } : {})}
          busy={busy}
          {...(error ? { error } : {})}
          onSave={header.save}
          onCancel={() => header.setEditing(undefined)}
        />
      </div>
    </div>
  );
}
