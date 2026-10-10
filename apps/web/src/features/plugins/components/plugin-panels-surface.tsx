"use client";

import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { TurnState } from "@telar/engine-client";
import { panelSourceKey, type PluginPanelSource } from "../panels";
import { cn } from "@/ui/utils";
import { PluginView } from "./plugin-view";

export function PluginPanelsSurface({
  sessionId,
  panels,
  active,
  onOpenFile,
}: {
  sessionId?: string;
  panels: readonly PluginPanelSource[];
  active?: TurnState;
  onOpenFile?: (path: string) => void;
}) {
  const [chosen, setChosen] = useState<string>();
  const [refreshes, setRefreshes] = useState(0);
  const source = panels.find((candidate) => panelSourceKey(candidate) === chosen) ?? panels[0];

  if (!sessionId) return <p className="p-4 text-xs text-muted-foreground">Start the session to see plugin panels.</p>;
  if (!source) return <p className="p-4 text-xs text-muted-foreground">No enabled plugin has a panel.</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        {panels.length > 1 &&
          panels.map((candidate) => (
            <button
              key={panelSourceKey(candidate)}
              type="button"
              onClick={() => setChosen(panelSourceKey(candidate))}
              className={cn("rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60", candidate === source && "bg-muted text-foreground")}
            >
              {candidate.pluginName} · {candidate.panel.label}
            </button>
          ))}
        {panels.length === 1 && <span className="px-1 text-xs text-muted-foreground">{source.pluginName} · {source.panel.label}</span>}
        <button type="button" aria-label="Refresh" onClick={() => setRefreshes((count) => count + 1)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted/60">
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <PluginView
          key={panelSourceKey(source)}
          scope={{ sessionId }}
          plugin={source.plugin}
          verb={source.panel.verb}
          refreshKey={`${active ?? ""}:${refreshes}`}
          {...(onOpenFile ? { onOpenFile } : {})}
        />
      </div>
    </div>
  );
}
