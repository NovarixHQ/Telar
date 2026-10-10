"use client";

import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { TurnState } from "@telar/engine-client";
import { usePluginEvents } from "../hooks/use-plugin-events";
import { panelSourceKey, panelSourceLabel, type PluginPanelSource } from "../panels";
import { PluginFrame } from "../views/plugin-frame";
import { cn } from "@/ui/utils";
import { PluginView } from "./plugin-view";

export function PluginPanelsSurface({
  sessionId,
  projectId,
  hostId,
  panels,
  active,
  onOpenFile,
  onInsertText,
}: {
  sessionId?: string;
  projectId?: string;
  hostId?: string;
  panels: readonly PluginPanelSource[];
  active?: TurnState;
  onOpenFile?: (path: string) => void;
  onInsertText?: (text: string) => void;
}) {
  const [chosen, setChosen] = useState<string>();
  const [refreshes, setRefreshes] = useState(0);
  const source = panels.find((candidate) => panelSourceKey(candidate) === chosen) ?? panels[0];
  usePluginEvents(sessionId && hostId, { pluginId: source?.plugin, name: source?.panel?.refreshOn ?? [], ...(sessionId ? { sessionId } : {}) }, () =>
    setRefreshes((count) => count + 1),
  );

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
              {panelSourceLabel(candidate)}
            </button>
          ))}
        {panels.length === 1 && <span className="px-1 text-xs text-muted-foreground">{panelSourceLabel(source)}</span>}
        <button type="button" aria-label="Refresh" onClick={() => setRefreshes((count) => count + 1)} className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted/60">
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
      {source.frame ? (
        <div className="min-h-0 flex-1">
          <PluginFrame
            key={`${panelSourceKey(source)}:${refreshes}`}
            source={source.frame}
            sessionId={sessionId}
            {...(projectId ? { projectId } : {})}
            {...(hostId ? { hostId } : {})}
            {...(onOpenFile ? { onOpenFile } : {})}
            {...(onInsertText ? { onInsertText } : {})}
          />
        </div>
      ) : (
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
      )}
    </div>
  );
}
