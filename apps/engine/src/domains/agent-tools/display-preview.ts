import { z } from "zod";
import { ARTIFACT_CSP } from "@telar/engine-client";
import { MAX_ANSWER_CHARS } from "./tool-kit";

export const PreviewKind = z.enum(["html", "svg"]);
export type PreviewKind = z.infer<typeof PreviewKind>;

export const PreviewAppearance = z.enum(["light", "dark"]);
export type PreviewAppearance = z.infer<typeof PreviewAppearance>;

export const PREVIEW_WIDTH = { min: 240, max: 1600, initial: 728 } as const;
export const PREVIEW_TIMEOUT_MS = 20_000;

export type PreviewRequest = { html: string; width: number; appearance: PreviewAppearance; timeoutMs: number };

export const PreviewRendering = z.object({
  png: z.string().min(1),
  contentHeight: z.number().nonnegative(),
  capturedHeight: z.number().nonnegative(),
  console: z.array(z.object({ level: z.enum(["error", "warning"]), text: z.string(), stack: z.string().optional() })),
  failedLoads: z.array(z.object({ url: z.string(), reason: z.string() })),
});
export type PreviewRendering = z.infer<typeof PreviewRendering>;

export type PreviewRenderer = { render(request: PreviewRequest): Promise<PreviewRendering> };

export const NEEDS_DESKTOP = "Preview needs the Telar desktop app, which renders the page offscreen, and this engine runs without it. Publish with display_inline and ask the person to look.";

const STAND_IN_LOOKS: Record<PreviewAppearance, Record<string, string>> = {
  light: { background: "#ffffff", foreground: "#1f2328", muted: "#656d76", line: "#d0d7de", accent: "#0969da" },
  dark: { background: "#1c1c1e", foreground: "#e6edf3", muted: "#8d96a0", line: "#30363d", accent: "#4493f8" },
};

function previewTheme(appearance: PreviewAppearance): string {
  const tokens = Object.entries(STAND_IN_LOOKS[appearance])
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
  return `<style>:where(:root){color-scheme:${appearance};${tokens}background:var(--background)}:where(body){margin:0;padding:12px 14px;font:13px/1.5 system-ui,-apple-system,sans-serif;color:var(--foreground,CanvasText);background:transparent}</style>`;
}

const svgBody = (svg: string) =>
  `<img alt="" style="display:block;max-width:100%" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" onerror="console.error('The svg does not parse as an image, so the conversation would show nothing.')">`;

export function previewDocument(kind: PreviewKind, content: string, appearance: PreviewAppearance): string {
  const body = kind === "svg" ? svgBody(content) : content.replace(/^\s*<!doctype[^>]*>/i, "");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}"><meta charset="utf-8">${previewTheme(appearance)}${body}`;
}

export async function withinTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the preview took longer than ${Math.ceil(ms / 1000)} s; look for a script that never settles`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

const MAX_CONSOLE_ROWS = 20;
const MAX_STACK_CHARS = 1_200;

export function previewReport(rendering: PreviewRendering, input: { width: number; appearance: PreviewAppearance }): string {
  const height =
    rendering.capturedHeight < rendering.contentHeight
      ? `${rendering.contentHeight} px tall; the screenshot shows the first ${rendering.capturedHeight} px`
      : `${rendering.contentHeight} px tall`;
  const lines = [`Rendered ${input.width} px wide in ${input.appearance}: the content is ${height}.`];
  const shown = rendering.console.slice(0, MAX_CONSOLE_ROWS);
  lines.push(shown.length === 0 ? "Console: no errors or warnings." : `Console (${rendering.console.length}):`);
  for (const entry of shown) {
    lines.push(`- ${entry.level}: ${entry.text}`);
    if (entry.stack) lines.push(entry.stack.slice(0, MAX_STACK_CHARS).replace(/^/gm, "    "));
  }
  if (rendering.console.length > shown.length) lines.push(`- … ${rendering.console.length - shown.length} more`);
  lines.push(rendering.failedLoads.length === 0 ? "Failed loads: none." : "Failed loads (html has no network; inline every script, style, font and image):");
  for (const load of rendering.failedLoads.slice(0, MAX_CONSOLE_ROWS)) lines.push(`- ${load.url.slice(0, 200)}: ${load.reason}`);
  lines.push("Nothing is published yet. When it looks right, call display_inline with the same source.");
  return lines.join("\n").slice(0, MAX_ANSWER_CHARS);
}
