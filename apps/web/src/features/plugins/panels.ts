import type { PluginPanel, PluginStatus } from "@telar/engine-client";
import { richViews, type FrameSource } from "./views/contributions";

/** A panel drawn from blocks, or one a plugin draws itself in a frame. */
export type PluginPanelSource =
  | { plugin: string; pluginName: string; panel: PluginPanel; frame?: never }
  | { plugin: string; pluginName: string; frame: FrameSource; panel?: never };

export function pluginPanelSources(statuses: readonly PluginStatus[], enabled: readonly string[]): PluginPanelSource[] {
  const on = new Set(enabled);
  return [
    ...statuses.flatMap((status) =>
      status.state === "ready" && on.has(status.meta.id)
        ? (status.meta.panels ?? []).map((panel) => ({ plugin: status.meta.id, pluginName: status.meta.name, panel }))
        : [],
    ),
    ...richViews(enabled, statuses).map((frame) => ({ plugin: frame.plugin, pluginName: frame.pluginName, frame })),
  ];
}

export const panelSourceKey = (source: PluginPanelSource) => `${source.plugin}/${source.panel ? source.panel.id : `view:${source.frame.view.id}`}`;

export const panelSourceLabel = (source: PluginPanelSource) => `${source.pluginName} · ${source.panel ? source.panel.label : source.frame.view.label}`;
