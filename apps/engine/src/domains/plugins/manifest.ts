import { z } from "zod";
import { PLUGIN_API_VERSION, type PluginManifest, type PluginMeta } from "@telar/engine-client";
import { err, json, type ToolFactory } from "../agent-tools";
import type { PluginToolModule } from "./tool-module";

/** The session verb every declared tool travels under; a manifest may not declare a route by that name. */
export const TOOL_VERB = "tool";

export function manifestMeta(manifest: PluginManifest): PluginMeta {
  return {
    id: manifest.id,
    api: PLUGIN_API_VERSION,
    name: manifest.name,
    version: manifest.version,
    ...(manifest.description ? { blurb: manifest.description } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    toolPrefixes: manifest.toolPrefix ? [manifest.toolPrefix] : [],
    readTools: [],
    ...(manifest.briefing ? { briefing: manifest.briefing } : {}),
    eventKinds: manifest.eventKinds,
    ...(manifest.gitignore ? { gitignore: manifest.gitignore } : {}),
    ...(manifest.panels.length > 0 ? { panels: manifest.panels } : {}),
    ...(manifest.composer ? { composer: manifest.composer } : {}),
    ...(manifest.viewers.length > 0 ? { viewers: manifest.viewers } : {}),
    ...(manifest.views.length > 0 ? { views: manifest.views } : {}),
    ...(manifest.fileScope.length > 0 ? { fileScope: manifest.fileScope } : {}),
    settings: manifest.settings ?? [
      { id: "settings", scope: "project" as const, label: manifest.name },
      ...(manifest.machineSettingsSchema ? [{ id: "defaults", scope: "machine" as const, label: manifest.name }] : []),
    ],
  };
}

export function zodFrom(schema: Record<string, unknown> | undefined): z.ZodType<unknown> | undefined {
  if (!schema) return undefined;
  try {
    return z.fromJSONSchema(schema as never) as z.ZodType<unknown>;
  } catch {
    return z.record(z.string(), z.unknown());
  }
}

function shapeOf(schema: Record<string, unknown>): Record<string, unknown> {
  try {
    const parsed = z.fromJSONSchema(schema as never);
    return parsed instanceof z.ZodObject ? (parsed.shape as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The worker's tool wall for any manifest: each declared tool calls the engine's `tool` verb. */
export function manifestToolModule(manifest: PluginManifest): PluginToolModule {
  return {
    meta: manifestMeta(manifest),
    capability: (call) => ({ call }),
    tools(tool: ToolFactory, capability: unknown) {
      const { call } = capability as { call: <T>(verb: string, body?: unknown) => Promise<T> };
      return manifest.tools.map((declared) =>
        tool(declared.name, declared.description, shapeOf(declared.inputSchema), async (args) => {
          try {
            const answer = await call<{ content?: unknown[]; isError?: boolean }>(TOOL_VERB, { name: declared.name, arguments: args });
            return Array.isArray(answer?.content) ? { content: answer.content, ...(answer.isError ? { isError: true } : {}) } : json(answer);
          } catch (error) {
            return err(error instanceof Error ? error.message : String(error));
          }
        }),
      );
    },
  };
}
