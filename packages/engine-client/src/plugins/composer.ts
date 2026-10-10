import { z } from "zod";

const Slug = z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits and dashes").max(32);

/** The looks a decoration may take; the cockpit owns what each one draws. */
export const PluginDecorationStyle = z.enum(["math", "code", "accent", "muted"]);
export type PluginDecorationStyle = z.infer<typeof PluginDecorationStyle>;

/** A JavaScript regular expression source, matched one line at a time with the `u` flag. */
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
  /** Shown while the caret is inside a match: a built-in renderer, or a session route that answers `{ text }`. */
  preview: z.union([z.strictObject({ renderer: z.literal("katex") }), z.strictObject({ verb: Slug })]).optional(),
});
export type PluginDecoration = z.infer<typeof PluginDecoration>;

/** `/<name> <text>` sends `{ text }` to the session route `verb` and puts the answer's `text` where the command was. */
export const PluginComposerCommand = z.strictObject({
  name: Slug,
  description: z.string().min(1).max(120),
  verb: Slug,
  /** What to type after the command, shown in the menu. */
  hint: z.string().min(1).max(60).optional(),
});
export type PluginComposerCommand = z.infer<typeof PluginComposerCommand>;

export const PluginComposer = z.strictObject({
  decorations: z.array(PluginDecoration).max(8).default([]),
  commands: z.array(PluginComposerCommand).max(8).default([]),
});
export type PluginComposer = z.infer<typeof PluginComposer>;

/** The verbs a composer contribution calls; each must be a declared session route. */
export function composerVerbs(composer: PluginComposer): { path: (string | number)[]; verb: string }[] {
  return [
    ...composer.decorations.flatMap((decoration, index) =>
      decoration.preview && "verb" in decoration.preview ? [{ path: ["decorations", index, "preview", "verb"], verb: decoration.preview.verb }] : [],
    ),
    ...composer.commands.map((command, index) => ({ path: ["commands", index, "verb"], verb: command.verb })),
  ];
}

/** The longest answer a command or preview route may return. */
export const PLUGIN_COMPOSER_TEXT_MAX = 20_000;

export function parseComposerAnswer(value: unknown): string {
  const text = (value as { text?: unknown } | null)?.text;
  if (typeof text !== "string") throw new Error("the plugin answered without text");
  if (text.length > PLUGIN_COMPOSER_TEXT_MAX) throw new Error("the plugin's answer is too long");
  return text;
}
