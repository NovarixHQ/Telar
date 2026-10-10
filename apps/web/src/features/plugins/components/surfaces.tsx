"use client";

import { Suspense, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { EngineEvent, TurnState } from "@telar/engine-client";
import type { PluginPanelSource } from "../panels";
import type { PluginSurfaceId } from "../registry";

const DataSurface = dynamic(() => import("../data-science/data-surface").then((mod) => mod.DataSurface));
const PluginPanelsSurface = dynamic(() => import("./plugin-panels-surface").then((mod) => mod.PluginPanelsSurface));

export type PluginSurfaceProps = {
  sessionId?: string;
  projectId?: string;
  hostId?: string;
  active?: TurnState;
  events: readonly EngineEvent[];
  onOpenImage?: (attachmentId: string) => void;
  onOpenFile: (path: string) => void;
  panels?: readonly PluginPanelSource[];
};

const SURFACES: Record<PluginSurfaceId, (props: PluginSurfaceProps) => ReactNode> = {
  data: ({ sessionId, projectId, hostId, active, events, onOpenImage }) => (
    <DataSurface
      {...(sessionId ? { sessionId } : {})}
      {...(projectId ? { projectId } : {})}
      {...(hostId ? { hostId } : {})}
      {...(active ? { active } : {})}
      events={events}
      {...(onOpenImage ? { onOpenImage } : {})}
    />
  ),
  "plugin-panels": ({ sessionId, hostId, active, panels, onOpenFile }) => (
    <PluginPanelsSurface
      {...(sessionId ? { sessionId } : {})}
      {...(hostId ? { hostId } : {})}
      {...(active ? { active } : {})}
      panels={panels ?? []}
      onOpenFile={onOpenFile}
    />
  ),
};

export function PluginSurface({ id, ...props }: PluginSurfaceProps & { id: PluginSurfaceId }) {
  return <Suspense fallback={null}>{SURFACES[id](props)}</Suspense>;
}
