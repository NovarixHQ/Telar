import type { PluginRichView, PluginStatus, PluginViewer } from "@telar/engine-client";

/** What a frame needs to know about who drew it. */
export type FrameSource = { plugin: string; pluginName: string; view: PluginViewer | PluginRichView; fileScope: readonly string[] };

const NONE: readonly PluginStatus[] = [];
let statuses: readonly PluginStatus[] = NONE;
const listeners = new Set<() => void>();

/** The engine's plugin list, as last read; viewers and frame views come from it. */
export function setPluginStatuses(next: readonly PluginStatus[]): void {
  statuses = next;
  for (const listener of listeners) listener();
}

export const pluginStatusesStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  snapshot: () => statuses,
  serverSnapshot: () => NONE,
};

export function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

const ready = (from: readonly PluginStatus[], enabled: readonly string[]) => {
  const on = new Set(enabled);
  return from.filter((status) => status.state === "ready" && on.has(status.meta.id));
};

const sourceOf = (status: PluginStatus, view: PluginViewer | PluginRichView): FrameSource => ({
  plugin: status.meta.id,
  pluginName: status.meta.name,
  view,
  fileScope: status.meta.fileScope ?? [],
});

/** The first enabled plugin that views this path, by extension or by media type. */
export function viewerFor(path: string, enabled: readonly string[], mediaType?: string, from: readonly PluginStatus[] = statuses): FrameSource | undefined {
  const extension = fileExtension(path);
  for (const status of ready(from, enabled)) {
    const viewer = status.meta.viewers?.find((candidate) => (extension && candidate.extensions.includes(extension)) || (mediaType && candidate.mimes.includes(mediaType)));
    if (viewer) return sourceOf(status, viewer);
  }
  return undefined;
}

export function richViews(enabled: readonly string[], from: readonly PluginStatus[] = statuses): FrameSource[] {
  return ready(from, enabled).flatMap((status) => (status.meta.views ?? []).map((view) => sourceOf(status, view)));
}
