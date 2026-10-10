import { z } from "zod";
import type { PluginManifestInput } from "@telar/engine-client";
import type { PluginEngine, PluginSession, PluginToolAnswer } from ".";

const MAX_ANSWER_CHARS = 16_000;

export const ok = (text: string): PluginToolAnswer => ({ content: [{ type: "text", text }] });
export const err = (text: string): PluginToolAnswer => ({ content: [{ type: "text", text }], isError: true });
export const failure = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function json(value: unknown, max = MAX_ANSWER_CHARS): PluginToolAnswer {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return ok(text.length <= max ? text : `${text.slice(0, max)}\n[… ${text.length - max} more characters not shown]`);
}

type Handler = (args: Record<string, unknown>) => Promise<PluginToolAnswer>;

/** Declares one tool: its name, what it does, its arguments as a zod shape, and what it answers. */
export type ToolFactory = (name: string, description: string, shape: z.ZodRawShape, handler: Handler) => unknown;

type Declared = { name: string; description: string; shape: z.ZodRawShape; handler: Handler };

const collect = <C>(build: (tool: ToolFactory, capability: C) => unknown[], capability: C): Declared[] =>
  build((name, description, shape, handler) => ({ name, description, shape, handler }), capability) as Declared[];

/**
 * Tools written against a per-session capability: the manifest's declarations, and handlers that build the
 * capability for the calling session. A capability that cannot be built answers as a failed tool, never a crash.
 */
export function capabilityTools<C>(build: (tool: ToolFactory, capability: C) => unknown[], meta: { readOnly?: readonly string[] } = {}) {
  const declarations: NonNullable<PluginManifestInput["tools"]> = collect(build, undefined as C).map(({ name, description, shape }) => {
    const { $schema: _schema, ...inputSchema } = z.toJSONSchema(z.object(shape), { unrepresentable: "any" }) as Record<string, unknown>;
    void _schema;
    return { name, description, inputSchema, ...(meta.readOnly?.includes(name) ? { readOnly: true } : {}) };
  });
  const handlers = (capability: (session: PluginSession) => C): NonNullable<PluginEngine["tools"]> =>
    Object.fromEntries(
      declarations.map(({ name }) => [
        name,
        async (args: Record<string, unknown>, session: PluginSession) => {
          let tools: Declared[];
          try {
            tools = collect(build, capability(session));
          } catch (error) {
            return err(failure(error));
          }
          return tools.find((tool) => tool.name === name)!.handler(args);
        },
      ]),
    );
  return { declarations, handlers };
}
