import { PLUGIN_EVENT_MAX_BYTES, PluginEventInput, type PluginEventFrame } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel/errors";

type SessionEntry = Extract<PluginEventFrame, { scope: "session" }>;

export type PluginEventDeps = {
  now(): number;
  journal(sessionId: string, entry: Omit<SessionEntry, "at" | "id" | "sessionId">): { id: number; at: number };
  checkSession(pluginId: string, sessionId: string): void;
  checkProject(pluginId: string, projectId: string): void;
};

export type PluginEvents = ReturnType<typeof createPluginEvents>;

const refuse = (message: string) => new EngineStateError("invalid_request", message);

/** The one door a plugin's events go through: declared names only, gated like its routes, then journaled or broadcast. */
export function createPluginEvents(deps: PluginEventDeps) {
  const listeners = new Set<(frame: PluginEventFrame) => void>();
  return {
    emit(pluginId: string, declared: readonly string[], value: unknown): PluginEventFrame {
      const parsed = PluginEventInput.safeParse(value);
      if (!parsed.success) throw refuse(`${pluginId}: ${parsed.error.issues[0]?.message ?? "not a plugin event"}`);
      const input = parsed.data;
      if (!declared.includes(input.name)) throw refuse(`${pluginId} did not declare the event ${input.name}`);
      const data = input.data ?? null;
      if (JSON.stringify(data).length > PLUGIN_EVENT_MAX_BYTES) throw refuse(`${pluginId}: ${input.name} carries more than ${PLUGIN_EVENT_MAX_BYTES} bytes`);
      if (input.scope === "session") {
        deps.checkSession(pluginId, input.sessionId);
        const entry = { type: "plugin.event" as const, pluginId, scope: "session" as const, name: input.name, data, ...(input.note ? { note: input.note } : {}) };
        const { id, at } = deps.journal(input.sessionId, entry);
        return { ...entry, sessionId: input.sessionId, id, at };
      }
      if (input.scope === "project") deps.checkProject(pluginId, input.projectId);
      const frame = { ...input, type: "plugin.event" as const, pluginId, data, at: deps.now() };
      for (const listener of listeners) listener(frame);
      return frame;
    },
    watch(listener: (frame: PluginEventFrame) => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
