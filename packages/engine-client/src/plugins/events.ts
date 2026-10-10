import { z } from "zod";
import { PluginEventName, PluginId } from "./schema";

export const PLUGIN_EVENT_MAX_BYTES = 64 * 1024;

export const PluginEventScope = z.enum(["session", "project", "machine"]);
export type PluginEventScope = z.infer<typeof PluginEventScope>;

export const PluginEventNote = z.strictObject({
  text: z.string().min(1).max(500),
  failed: z.boolean().optional(),
  attachmentId: z.string().min(1).optional(),
});
export type PluginEventNote = z.infer<typeof PluginEventNote>;

const body = {
  pluginId: PluginId,
  name: PluginEventName,
  data: z.unknown(),
  note: PluginEventNote.optional(),
};

export const PluginEventInput = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("session"), sessionId: z.string().min(1), name: PluginEventName, data: z.unknown().optional(), note: PluginEventNote.optional() }),
  z.strictObject({ scope: z.literal("project"), projectId: z.string().min(1), name: PluginEventName, data: z.unknown().optional() }),
  z.strictObject({ scope: z.literal("machine"), name: PluginEventName, data: z.unknown().optional() }),
]);
export type PluginEventInput = z.infer<typeof PluginEventInput>;

export const PluginEventFrame = z.discriminatedUnion("scope", [
  z.object({ type: z.literal("plugin.event"), at: z.number(), scope: z.literal("session"), sessionId: z.string(), id: z.number(), ...body }),
  z.object({ type: z.literal("plugin.event"), at: z.number(), scope: z.literal("project"), projectId: z.string(), ...body }),
  z.object({ type: z.literal("plugin.event"), at: z.number(), scope: z.literal("machine"), ...body }),
]);
export type PluginEventFrame = z.infer<typeof PluginEventFrame>;

export const pluginEventJournalShape = { pluginId: PluginId, scope: z.literal("session"), name: PluginEventName, data: z.unknown(), note: PluginEventNote.optional() };

export function parsePluginEventFrame(value: unknown): PluginEventFrame | undefined {
  if ((value as { type?: unknown } | null)?.type !== "plugin.event") return undefined;
  const parsed = PluginEventFrame.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function pluginEventsIn<E extends { type: string }>(events: readonly E[], pluginId: string, name?: string) {
  return events.filter(
    (event): event is E & { pluginId: string; name: string; data: unknown } =>
      event.type === "plugin.event" && (event as { pluginId?: unknown }).pluginId === pluginId && (name === undefined || (event as { name?: unknown }).name === name),
  );
}
