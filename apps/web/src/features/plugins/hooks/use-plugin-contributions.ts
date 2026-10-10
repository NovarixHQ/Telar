"use client";

import { useEffect, useMemo, useState } from "react";
import { parseComposerAnswer, registerPluginToolPrefixes, type PluginStatus } from "@telar/engine-client";
import type { ComposerExtensions } from "@/features/composer";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher } from "@/platform/engine/host-client";
import { composerExtensions } from "../composer";
import { pluginPanelSources, type PluginPanelSource } from "../panels";
import { PLUGIN_WEB } from "../registry";

const NONE: readonly PluginStatus[] = [];
const NO_PANELS: readonly PluginPanelSource[] = [];

export function usePluginContributions(hostId: string, enabled: readonly string[], sessionId: string | undefined): { panels: readonly PluginPanelSource[]; composer: ComposerExtensions } {
  const [statuses, setStatuses] = useState<readonly PluginStatus[]>(NONE);
  const installed = enabled.some((id) => !Object.hasOwn(PLUGIN_WEB, id));
  useEffect(() => {
    let cancelled = false;
    if (!installed) {
      const task = window.setTimeout(() => !cancelled && setStatuses(NONE), 0);
      return () => {
        cancelled = true;
        window.clearTimeout(task);
      };
    }
    createEngineApi(hostFetcher(hostId))
      .machinePlugins()
      .then(
        ({ plugins }) => {
          if (cancelled) return;
          registerPluginToolPrefixes(plugins.flatMap((status) => status.meta.toolPrefixes));
          setStatuses(plugins);
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, [hostId, enabled, installed]);
  const panels = useMemo(() => {
    const found = pluginPanelSources(statuses, enabled);
    return found.length > 0 ? found : NO_PANELS;
  }, [statuses, enabled]);
  const composer = useMemo(() => {
    const api = createEngineApi(hostFetcher(hostId));
    const call = sessionId
      ? (plugin: string, verb: string, text: string) => api.sessionPluginVerb(sessionId, plugin, verb, { text }).then(parseComposerAnswer)
      : undefined;
    return composerExtensions(statuses, enabled, call);
  }, [statuses, enabled, hostId, sessionId]);
  return { panels, composer };
}
