import { z } from "zod";
import { ARTIFACT_BASE_CSS, artifactRootTag, artifactTheme, type ArtifactTheme, artifactThemeCss, cssColorToHex, mermaidThemeVariables, type PublishedAppearance, TELAR_DARK, TELAR_LIGHT } from "@telar/engine-client";
import { MAX_ANSWER_CHARS } from "./tool-kit";

export const PreviewKind = z.enum(["html", "svg", "mermaid"]);
export type PreviewKind = z.infer<typeof PreviewKind>;

export const PreviewAppearance = z.enum(["light", "dark"]);
export type PreviewAppearance = z.infer<typeof PreviewAppearance>;

export const PREVIEW_WIDTH = { min: 240, max: 1600, initial: 728 } as const;
export const PREVIEW_TIMEOUT_MS = 7_000;

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

const GLOBALS_CSS_TOKENS: Record<PreviewAppearance, Record<string, string>> = {
  light: {
    "--primary": "oklch(0.488 0.16 264)",
    "--primary-foreground": "oklch(1 0 0)",
    "--info": "oklch(0.51 0.09 215)",
    "--success": "oklch(0.495 0.108 162)",
    "--warning": "oklch(0.515 0.11 72)",
    "--destructive": "oklch(0.50 0.19 25.5)",
    "--chart-1": "oklch(0.56 0.16 264)",
    "--chart-2": "oklch(0.56 0.15 336)",
    "--tint-green": "oklch(0.56 0.13 155)",
    "--tint-orange": "oklch(0.58 0.14 55)",
    "--tint-cyan": "oklch(0.56 0.095 200)",
    "--tint-yellow": "oklch(0.58 0.12 85)",
    "--tint-blue": "oklch(0.56 0.15 245)",
    "--tint-red": "oklch(0.56 0.16 20)",
    "--tint-pink": "oklch(0.56 0.16 350)",
    "--tint-purple": "oklch(0.56 0.16 295)",
    "--radius": "0.625rem",
  },
  dark: {
    "--primary": "oklch(0.68 0.16 264)",
    "--primary-foreground": "oklch(0.17 0.04 264)",
    "--info": "oklch(0.74 0.125 215)",
    "--success": "oklch(0.73 0.15 162)",
    "--warning": "oklch(0.78 0.15 72)",
    "--destructive": "oklch(0.7 0.19 25.5)",
    "--chart-1": "oklch(0.74 0.13 264)",
    "--chart-2": "oklch(0.74 0.15 336)",
    "--tint-green": "oklch(0.74 0.14 155)",
    "--tint-orange": "oklch(0.77 0.14 55)",
    "--tint-cyan": "oklch(0.74 0.1 200)",
    "--tint-yellow": "oklch(0.79 0.14 85)",
    "--tint-blue": "oklch(0.74 0.13 245)",
    "--tint-red": "oklch(0.74 0.15 20)",
    "--tint-pink": "oklch(0.74 0.15 350)",
    "--tint-purple": "oklch(0.74 0.16 295)",
    "--radius": "0.625rem",
  },
};

const ALIASES: Record<string, string> = {
  "--ring": "--primary",
  "--sidebar-foreground": "--foreground",
  "--sidebar-primary": "--primary",
  "--sidebar-accent-foreground": "--accent-foreground",
  "--sidebar-border": "--border",
  "--sidebar-ring": "--primary",
};

function depth(scheme: PreviewAppearance, ink: string, canvas: string): Record<string, string> {
  const [tint, lift, ring, ambient] = scheme === "dark" ? [`color-mix(in oklab, ${canvas} 45%, #000)`, 0.5, 33, 8] : [`color-mix(in oklab, ${ink} 92%, ${canvas})`, 1, 10, 23];
  const layer = (alpha: number) => `color-mix(in oklab, ${tint} ${alpha}%, transparent)`;
  const rung = (contact: string, y: number, blur: number, spread: number) => `0 ${contact} ${layer(ring)}, 0 ${y * lift}px ${blur * lift}px ${spread * lift}px ${layer(ambient)}`;
  return {
    "--overlay": scheme === "dark" ? `${canvas}8c` : `${ink}1a`,
    "--shadow-1": rung("1px 1px -1px", 2, 6, -4),
    "--shadow-2": rung("1px 2px -1px", 8, 24, -14),
    "--shadow-3": rung("2px 4px -2px", 18, 48, -26),
  };
}

export function previewTheme(scheme: PreviewAppearance, published: PublishedAppearance | null | undefined): ArtifactTheme {
  const surfaces: Record<string, string> = { ...(scheme === "dark" ? TELAR_DARK : TELAR_LIGHT), ...published?.look.composition[scheme].overrides };
  const accent = published?.resolved?.accent[scheme];
  const tokens: Record<string, string> = {
    ...GLOBALS_CSS_TOKENS[scheme],
    ...Object.fromEntries(Object.entries(surfaces).map(([name, value]) => [`--${name}`, value])),
    ...(accent ? { "--primary": accent.primary, "--primary-foreground": accent.primaryForeground } : {}),
    "--app-font-sans": published?.resolved?.fontStacks.sans ?? "system-ui, -apple-system, sans-serif",
    "--app-font-mono": published?.resolved?.fontStacks.mono ?? "ui-monospace, monospace",
  };
  for (const [alias, token] of Object.entries(ALIASES)) tokens[alias] ??= tokens[token] ?? "";
  const [ink, canvas] = [cssColorToHex(tokens["--foreground"] ?? ""), cssColorToHex(tokens["--background"] ?? "")];
  if (ink && canvas) Object.assign(tokens, depth(scheme, ink.slice(0, 7), canvas.slice(0, 7)));
  return artifactTheme(scheme, (token) => tokens[token] ?? "");
}

const MERMAID_MODULE = "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.esm.min.mjs";

const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");

const svgImage = (svg: string) =>
  `<img alt="" style="display:block;max-width:100%" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" onerror="console.error('The svg does not parse as an image, so the conversation would show nothing.')">`;

function mermaidBody(source: string, theme: ArtifactTheme): string {
  const config = { startOnLoad: false, theme: "base", securityLevel: "strict", fontFamily: "monospace", suppressErrorRendering: true, themeVariables: mermaidThemeVariables(theme), htmlLabels: false, flowchart: { htmlLabels: false } };
  return `<script>window.__previewReady=import(${json(MERMAID_MODULE)}).then(async({default:mermaid})=>{mermaid.initialize(${json(config)});const{svg}=await mermaid.render("preview",${json(source)});const image=new Image();image.alt="";image.style.cssText="display:block;max-width:100%";image.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);document.body.append(image);await image.decode();}).catch((error)=>console.error("This diagram could not be drawn: "+(error?.message??error)));</script>`;
}

export function previewDocument(kind: PreviewKind, content: string, theme: ArtifactTheme): string {
  const body = kind === "svg" ? svgImage(content) : kind === "mermaid" ? mermaidBody(content, theme) : content.replace(/^\s*<!doctype[^>]*>/i, "");
  return `<!doctype html>${artifactRootTag(theme)}<meta charset="utf-8"><style>${artifactThemeCss(theme)}${ARTIFACT_BASE_CSS}</style>${body}`;
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

export function previewReport(rendering: PreviewRendering & { missingImages?: string[] }, input: { width: number; appearance: PreviewAppearance }): string {
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
  lines.push(rendering.failedLoads.length === 0 ? "Failed loads: none." : "Failed loads:");
  for (const load of rendering.failedLoads.slice(0, MAX_CONSOLE_ROWS)) lines.push(`- ${load.url.slice(0, 200)}: ${load.reason}`);
  const missing = rendering.missingImages ?? [];
  if (missing.length > 0) lines.push(`Missing images, shown broken (display_inline refuses them): ${missing.slice(0, MAX_CONSOLE_ROWS).join(", ")}.`);
  lines.push("Nothing is published yet. When it looks right, call display_inline with the same source.");
  return lines.join("\n").slice(0, MAX_ANSWER_CHARS);
}
