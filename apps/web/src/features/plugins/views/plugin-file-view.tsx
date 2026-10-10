"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { pluginStatusesStore, viewerFor } from "./contributions";
import { PluginFrame, type PluginFrameProps } from "./plugin-frame";

/** The enabled plugin's viewer for `path`, or `fallback` while none is on or the plugin list is still loading. */
export function PluginFileView({ path, enabledPlugins, fallback, ...frame }: Omit<PluginFrameProps, "source" | "path"> & { path: string; enabledPlugins: readonly string[]; fallback: ReactNode }) {
  const statuses = useSyncExternalStore(pluginStatusesStore.subscribe, pluginStatusesStore.snapshot, pluginStatusesStore.serverSnapshot);
  const source = viewerFor(path, enabledPlugins, undefined, statuses);
  if (!source) return fallback;
  return <PluginFrame key={`${frame.hostId ?? ""}:${frame.sessionId ?? ""}:${source.plugin}/${source.view.id}:${path}`} source={source} path={path} {...frame} />;
}
