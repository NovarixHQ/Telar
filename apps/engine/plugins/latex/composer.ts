import type { PluginComposer } from "@telar/engine-client";
import type { PluginHost } from "../sdk";

const SYSTEM = [
  "You turn a plain-language description into LaTeX.",
  "Answer with the LaTeX only: no prose, no code fences.",
  "Wrap a formula in $...$ when it reads inline and in $$...$$ when it is a display; anything else (a table, a figure) is plain LaTeX.",
].join(" ");

const FENCE = /^```[a-z]*\n?([\s\S]*?)\n?```$/i;

/** Inline `$…$` (not touching a space inside, so "$5 and $10" stays plain) and display `$$…$$`, one line at a time. */
export const latexComposer: PluginComposer = {
  decorations: [
    { id: "display-math", pattern: String.raw`\$\$[^$]+?\$\$`, style: "math", multiline: true, preview: { renderer: "katex" } },
    { id: "inline-math", pattern: String.raw`(?<!\$)\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?![\d$])`, style: "math", preview: { renderer: "katex" } },
  ],
  commands: [{ name: "tex", description: "Write LaTeX from a plain description", verb: "tex", hint: "what to write, in words" }],
};

export async function texFromWords(host: Pick<PluginHost, "complete">, input: Record<string, unknown>): Promise<{ text: string }> {
  const words = typeof input.text === "string" ? input.text.trim() : "";
  if (!words) throw new Error("say what to write after /tex, such as /tex the integral of x squared from 0 to 1");
  const { text } = await host.complete({ system: SYSTEM, prompt: words, maxChars: 4_000 });
  const latex = (FENCE.exec(text.trim())?.[1] ?? text).trim();
  if (!latex) throw new Error("the model answered with nothing");
  return { text: latex };
}
