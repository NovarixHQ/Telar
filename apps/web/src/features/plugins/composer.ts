import type { PluginStatus } from "@telar/engine-client";
import type { ComposerDecoration, ComposerExtensions } from "@/features/composer";

export const NO_EXTENSIONS: ComposerExtensions = { decorations: [], commands: [] };

function compiled(source: string): RegExp | undefined {
  try {
    return new RegExp(source, "u");
  } catch {
    return undefined;
  }
}

export function composerExtensions(statuses: readonly PluginStatus[], enabled: readonly string[], call?: ComposerExtensions["call"]): ComposerExtensions {
  const on = statuses.filter((status) => status.state === "ready" && enabled.includes(status.meta.id) && status.meta.composer);
  if (on.length === 0) return NO_EXTENSIONS;
  const decorations = on.flatMap(({ meta }) =>
    meta.composer!.decorations.flatMap((decoration): ComposerDecoration[] => {
      const pattern = compiled(decoration.pattern);
      const preview = decoration.preview && ("renderer" in decoration.preview || call) ? decoration.preview : undefined;
      return pattern
        ? [{ key: `${meta.id}/${decoration.id}`, plugin: meta.id, pattern, style: decoration.style, ...(decoration.multiline ? { multiline: true } : {}), ...(preview ? { preview } : {}) }]
        : [];
    }),
  );
  const commands = call
    ? on.flatMap(({ meta }) => meta.composer!.commands.map((command) => ({ plugin: meta.id, pluginName: meta.name, ...command })))
    : [];
  return { decorations, commands, ...(call ? { call } : {}) };
}
