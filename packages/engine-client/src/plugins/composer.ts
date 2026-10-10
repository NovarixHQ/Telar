import { z } from "zod";

const Slug = z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits and dashes").max(32);

export const PluginDecorationStyle = z.enum(["math", "code", "accent", "muted"]);
export type PluginDecorationStyle = z.infer<typeof PluginDecorationStyle>;

const Pattern = z
  .string()
  .min(1)
  .max(200)
  .superRefine((source, context) => {
    let pattern: RegExp;
    try {
      pattern = new RegExp(source, "u");
    } catch (error) {
      context.addIssue({ code: "custom", message: `not a regular expression: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (pattern.test("")) context.addIssue({ code: "custom", message: "must not match empty text" });
  });

export const PluginDecoration = z.strictObject({
  id: Slug,
  pattern: Pattern,
  style: PluginDecorationStyle,
  multiline: z.boolean().optional(),
  preview: z.union([z.strictObject({ renderer: z.literal("katex") }), z.strictObject({ verb: Slug })]).optional(),
});
export type PluginDecoration = z.infer<typeof PluginDecoration>;

export const PluginComposerCommand = z.strictObject({
  name: Slug,
  description: z.string().min(1).max(120),
  verb: Slug,
  hint: z.string().min(1).max(60).optional(),
});
export type PluginComposerCommand = z.infer<typeof PluginComposerCommand>;

export const PluginComposer = z.strictObject({
  decorations: z.array(PluginDecoration).max(8).default([]),
  commands: z.array(PluginComposerCommand).max(8).default([]),
});
export type PluginComposer = z.infer<typeof PluginComposer>;

export function composerVerbs(composer: PluginComposer): { path: (string | number)[]; verb: string }[] {
  return [
    ...composer.decorations.flatMap((decoration, index) =>
      decoration.preview && "verb" in decoration.preview ? [{ path: ["decorations", index, "preview", "verb"], verb: decoration.preview.verb }] : [],
    ),
    ...composer.commands.map((command, index) => ({ path: ["commands", index, "verb"], verb: command.verb })),
  ];
}

export const PLUGIN_COMPOSER_TEXT_MAX = 20_000;

export function parseComposerAnswer(value: unknown): string {
  const text = (value as { text?: unknown } | null)?.text;
  if (typeof text !== "string") throw new Error("the plugin answered without text");
  if (text.length > PLUGIN_COMPOSER_TEXT_MAX) throw new Error("the plugin's answer is too long");
  return text;
}
