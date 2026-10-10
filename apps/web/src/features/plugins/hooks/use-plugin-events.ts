"use client";

import type { PluginEventFrame } from "@telar/engine-client";
import { usePluginFrames } from "@/platform/engine/sessions-stream";

export type PluginEventFilter = { pluginId: string | undefined; name: string | readonly string[]; sessionId?: string; projectId?: string };

function matchesPluginEvent(frame: PluginEventFrame, filter: PluginEventFilter): boolean {
  if (frame.pluginId !== filter.pluginId) return false;
  if (typeof filter.name === "string" ? frame.name !== filter.name : !filter.name.includes(frame.name)) return false;
  if (filter.sessionId !== undefined) return frame.scope === "session" && frame.sessionId === filter.sessionId;
  if (filter.projectId !== undefined) return frame.scope === "project" && frame.projectId === filter.projectId;
  return frame.scope === "machine";
}

export function usePluginEvents(hostId: string | undefined, filter: PluginEventFilter, onEvent: (frame: PluginEventFrame) => void): void {
  usePluginFrames(filter.pluginId ? hostId : undefined, (frame) => {
    if (matchesPluginEvent(frame, filter)) onEvent(frame);
  });
}
