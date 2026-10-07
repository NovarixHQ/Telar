import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { type Artifact, ARTIFACT_HEIGHT, ArtifactId, ArtifactKind, MAX_ARTIFACT_BYTES, type PublishedAppearance } from "@telar/engine-client";
import { NEEDS_DESKTOP, PREVIEW_TIMEOUT_MS, PREVIEW_WIDTH, PreviewAppearance, previewDocument, PreviewKind, previewTheme, type PreviewRenderer, type PreviewRendering, previewReport, withinTimeout } from "./display-preview";
import { err, failure, ok, type ToolFactory } from "./tool-kit";

type InlineInput = { kind: ArtifactKind; title: string; id?: string; height?: number; content?: string; path?: string };
type PreviewInput = { kind: PreviewKind; width: number; appearance?: PreviewAppearance; content?: string; path?: string };

export type DisplayCapability = {
  open(input: { path: string; title?: string }): Promise<{ path: string }>;
  inline(input: InlineInput): Promise<{ id: string }>;
  preview?(input: PreviewInput): Promise<PreviewRendering & { appearance: PreviewAppearance }>;
};

const OPEN = `Show the human a file from this checkout in the panel, rendered (markdown, PDF, image, video, code). For something you made for them to look at now.`;

const INLINE = `Draw a visual artifact into your reply: html, svg, mermaid or markdown (a chart is html or svg). Best for a status, overview, comparison, diagram or chart; otherwise reply in plain text, and honour a preference for md or html files. Html has no network: inline every script, style and image. display_preview is optional. Same id revises.`;

const PREVIEW = `Optional check before display_inline, for a complex or interactive page or one that looked wrong once published. Renders html, svg or mermaid offscreen in the Look: screenshot, height, console errors with stacks, failed loads. If it fails, publish anyway; don't retry.`;

const THEME_GUIDE = [
  "The source. Give this or path. Html and svg get the person's Look as CSS variables on :root, in hex with alpha kept, following Look changes live.",
  "Never redeclare them or guess fallbacks: a :root rule of yours replaces the Look.",
  "The scheme is explicit: data-scheme=\"dark\" or \"light\" on <html>, and color-scheme and --scheme on :root. Read it there, never from a colour's luminance; dark styles key off [data-scheme=dark].",
  "--background (the canvas behind the frame; transparent on a see-through Look), --foreground, --muted, --muted-foreground,",
  "--card, --card-foreground, --popover, --popover-foreground (raised surfaces), --border, --input (field borders and dark field fills), --ring (focus),",
  "--primary, --primary-foreground (solid buttons), --secondary, --secondary-foreground, --accent, --accent-foreground (hover surface), --overlay (modal scrim),",
  "--sidebar, --sidebar-foreground, --sidebar-primary, --sidebar-accent, --sidebar-accent-foreground, --sidebar-border, --sidebar-ring (the session list),",
  "--success, --warning, --info, --destructive, --tint-blue, --tint-cyan, --tint-green, --tint-yellow, --tint-orange, --tint-red, --tint-pink, --tint-purple,",
  "--chart-1, --chart-2, --chart-3, --chart-4, --chart-5, --chart-6 (categorical series, legible on --background and --card), --code-background, --code-foreground, --code-comment,",
  "--code-keyword, --code-string, --code-number, --code-function, --shadow-1, --shadow-2, --shadow-3 (box-shadow elevation), --radius, --font-sans, --font-mono.",
  "To mock a cockpit component, translate its classes onto these: bg-input/30 is color-mix(in srgb, var(--input) 30%, transparent), shadow-2 is var(--shadow-2), dark: is [data-scheme=dark].",
  "Never paint an opaque page background: html shows --background, the reply's own canvas. The base stylesheet sets html background, colour and font from these, body margin to 0, and hides the scrollbar. Mermaid takes the Look by itself.",
  "The page sits borderless on the reply's canvas, as wide as the reply column, with no frame or header around it: it is part of your reply.",
  "Use a fluid width with no outer card, border, banner title or horizontal padding on the outermost element. Give charts fixed pixel heights.",
  "Let content set the page's height: no 100vh or height:100% on html or body.",
  "House style, matching the reply: 14px text and 12px muted labels. Head each section with a short line stating the finding, then a muted one-line subtitle.",
  "Stat tiles are a row of large tabular numbers over muted labels, split by 1px var(--border) hairlines, not filled boxes.",
  "Charts are inline SVG in full-strength --chart-N colours with no heavy gridlines: label key points directly, keep a small square-swatch legend, 11px muted axis text.",
  "Tables have hairline rows, right-aligned tabular numbers, and --font-mono for code and paths.",
].join(" ");

export const DISPLAY_BRIEFING =
  "When the person asks for a status, overview, comparison, diagram or chart, an inline artifact from display_inline (tool search loads it) is usually best; otherwise reply in plain text and honour a preference for md or html files. Publish with display_inline, then reply without restating what the page shows. Publish simple charts and tables directly; display_preview is optional, for complex or interactive pages, and if it fails, publish anyway without retrying. The page is part of your reply: no outer card or title, and no opaque background. Its scheme is data-scheme on <html>; never guess it from a colour.";

function sourceOf(args: Record<string, unknown>): { content?: string; path?: string } | undefined {
  const content = typeof args.content === "string" && args.content.length > 0 ? args.content : undefined;
  const file = typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
  if ((content === undefined) === (file === undefined)) return undefined;
  return content !== undefined ? { content } : { path: file };
}

export function displayTools(tool: ToolFactory, capability: DisplayCapability): unknown[] {
  return [
    tool(
      "display_open",
      OPEN,
      {
        path: z.string().min(1).describe("Relative to the checkout root."),
        title: z.string().max(200).optional().describe("Shown beside the file."),
      },
      async (args) => {
        const path = typeof args.path === "string" ? args.path.trim() : "";
        if (!path) return err("Name the file to show (path, relative to the checkout root).");
        const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : undefined;
        try {
          const opened = await capability.open({ path, ...(title ? { title } : {}) });
          return ok(
            `Opened ${opened.path} in the right panel${title ? ` as "${title}"` : ""}. The human is looking at the rendered file, not its source; nothing further is needed unless you want to walk them through it.`,
          );
        } catch (error) {
          return err(`Could not display "${path}": ${failure(error)}`);
        }
      },
    ),
    tool(
      "display_inline",
      INLINE,
      {
        kind: ArtifactKind.describe("How to render it."),
        title: z.string().min(1).max(200).describe("Names it for the person and its saved file; it is not drawn on the page."),
        content: z.string().optional().describe(THEME_GUIDE),
        path: z.string().optional().describe("A file holding the source: relative to the checkout, or absolute in it or in /tmp. Never copy files into the project to show them."),
        id: z.string().optional().describe("Reuse an earlier artifact's id to add a new version of it."),
        height: z
          .number()
          .int()
          .min(ARTIFACT_HEIGHT.min)
          .max(ARTIFACT_HEIGHT.max)
          .optional()
          .describe("Html's height in CSS pixels, as display_preview reports it. The space is held while it loads so nothing moves; a smaller value makes the frame scroll inside."),
      },
      async (args) => {
        const kind = ArtifactKind.safeParse(args.kind);
        if (!kind.success) return err(`Name a kind: ${ArtifactKind.options.join(", ")}.`);
        const title = typeof args.title === "string" ? args.title.trim().slice(0, 200) : "";
        if (!title) return err("Give the artifact a title.");
        const source = sourceOf(args);
        if (!source) return err("Give exactly one of content or path.");
        const id = typeof args.id === "string" && args.id.trim() ? args.id.trim() : undefined;
        if (id !== undefined && !ArtifactId.safeParse(id).success) return err("An id is 1-64 letters, digits, dashes or underscores.");
        const height = args.height;
        if (height !== undefined && (typeof height !== "number" || !Number.isInteger(height) || height < ARTIFACT_HEIGHT.min || height > ARTIFACT_HEIGHT.max))
          return err(`The height is a whole number of pixels from ${ARTIFACT_HEIGHT.min} to ${ARTIFACT_HEIGHT.max}.`);
        try {
          const shown = await capability.inline({ kind: kind.data, title, ...(id ? { id } : {}), ...(height !== undefined ? { height } : {}), ...source });
          return ok(`Showing "${title}" in the conversation as artifact ${shown.id}, above your reply: don't restate or describe it. To revise it, call display_inline again with id "${shown.id}".`);
        } catch (error) {
          return err(`Could not show "${title}": ${failure(error)}`);
        }
      },
    ),
    tool(
      "display_preview",
      PREVIEW,
      {
        kind: PreviewKind.describe("How display_inline would render it."),
        content: z.string().optional().describe(THEME_GUIDE),
        path: z.string().optional().describe("A file holding the source: relative to the checkout, or absolute in it or in /tmp. Never copy files into the project to show them."),
        width: z.number().int().min(PREVIEW_WIDTH.min).max(PREVIEW_WIDTH.max).optional().describe(`CSS pixels; default ${PREVIEW_WIDTH.initial}, the conversation's width.`),
        appearance: PreviewAppearance.optional().describe("Default: the scheme the person's Look is in."),
      },
      async (args) => {
        const kind = PreviewKind.safeParse(args.kind);
        if (!kind.success) return err(`Name a kind: ${PreviewKind.options.join(", ")}.`);
        const source = sourceOf(args);
        if (!source) return err("Give exactly one of content or path.");
        const width = args.width ?? PREVIEW_WIDTH.initial;
        if (typeof width !== "number" || !Number.isInteger(width) || width < PREVIEW_WIDTH.min || width > PREVIEW_WIDTH.max) {
          return err(`The width is a whole number of pixels from ${PREVIEW_WIDTH.min} to ${PREVIEW_WIDTH.max}.`);
        }
        const appearance = args.appearance === undefined ? undefined : PreviewAppearance.safeParse(args.appearance);
        if (appearance && !appearance.success) return err("The appearance is light or dark.");
        if (!capability.preview) return err(NEEDS_DESKTOP);
        try {
          const rendering = await capability.preview({ kind: kind.data, width, ...(appearance ? { appearance: appearance.data } : {}), ...source });
          return {
            content: [
              { type: "image", data: rendering.png, mimeType: "image/png" },
              { type: "text", text: previewReport(rendering, { width, appearance: rendering.appearance }) },
            ],
          };
        } catch (error) {
          return err(`Could not preview it: ${failure(error)}. Publish it with display_inline anyway; don't retry the preview.`);
        }
      },
    ),
  ];
}

type DisplayObservation =
  | { kind: "display.opened"; path: string; title?: string }
  | { kind: "artifact.published"; artifact: Omit<Artifact, "version"> };

const tooLarge = (bytes: number) =>
  `it is ${Math.ceil(bytes / 1024)} KB and the limit is ${MAX_ARTIFACT_BYTES / 1024} KB; make it smaller, or write it to a file and use display_open`;

const SOURCE_ROOTS = ["/tmp", os.tmpdir()];

async function checkoutFile(cwd: string, target: string, alsoUnder: string[] = []): Promise<{ resolved: string; relative: string; stats: fs.Stats }> {
  const inside = (root: string, candidate: string) => candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
  const roots = [cwd, ...alsoUnder];
  const outside = alsoUnder.length > 0 ? "the path is outside this session's checkout and the temp folder; pass the content instead" : "the path is outside this session's checkout";
  const resolved = path.resolve(cwd, target);
  if (!roots.some((root) => inside(root, resolved))) throw new Error(outside);
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(resolved);
  } catch {
    throw new Error("no such file — write it first, or pass the content inline");
  }
  if (stats.isDirectory()) throw new Error("that path is a directory; name one file");
  if (!stats.isFile()) throw new Error("that path is not a regular file");
  const real = await fs.promises.realpath(resolved);
  const realRoots = await Promise.all(roots.map((root) => fs.promises.realpath(root).catch(() => undefined)));
  if (!realRoots.some((root) => root !== undefined && inside(root, real))) throw new Error(outside);
  return { resolved, relative: path.relative(cwd, resolved).split(path.sep).join("/"), stats };
}

async function sourceBytes(cwd: string, source: { content?: string; path?: string }): Promise<Uint8Array> {
  let data: Uint8Array;
  if (source.path !== undefined) {
    const { resolved, stats } = await checkoutFile(cwd, source.path, SOURCE_ROOTS);
    if (stats.size > MAX_ARTIFACT_BYTES) throw new Error(tooLarge(stats.size));
    data = new Uint8Array(await fs.promises.readFile(resolved));
  } else {
    data = new TextEncoder().encode(source.content ?? "");
  }
  if (data.byteLength === 0) throw new Error("the artifact is empty");
  if (data.byteLength > MAX_ARTIFACT_BYTES) throw new Error(tooLarge(data.byteLength));
  return data;
}

export function createDisplayCapability(input: {
  cwd: string;
  report(observation: DisplayObservation): Promise<void>;
  upload(file: { name: string; mediaType: string; data: Uint8Array }): Promise<{ id: string }>;
  renderer?: PreviewRenderer;
  look?: () => Promise<PublishedAppearance | null>;
  previewTimeoutMs?: number;
}): DisplayCapability {
  const { renderer, previewTimeoutMs = PREVIEW_TIMEOUT_MS } = input;
  return {
    async open({ path: target, title }) {
      const { relative } = await checkoutFile(input.cwd, target);
      await input.report({ kind: "display.opened", path: relative, ...(title ? { title } : {}) });
      return { path: relative };
    },
    async inline({ kind, title, id = `art_${crypto.randomUUID().slice(0, 8)}`, height, content, path: target }) {
      const data = await sourceBytes(input.cwd, { content, path: target });
      // Stored as plain text whatever the kind, so the bytes route can never serve it as a page.
      const attachment = await input.upload({ name: `${id}.txt`, mediaType: "text/plain", data });
      await input.report({ kind: "artifact.published", artifact: { id, kind, title, attachmentId: attachment.id, ...(height !== undefined ? { height } : {}) } });
      return { id };
    },
    ...(renderer
      ? {
          async preview({ kind, width, appearance, content, path: target }: PreviewInput) {
            const source = new TextDecoder().decode(await sourceBytes(input.cwd, { content, path: target }));
            const published = await input.look?.().catch(() => null);
            const scheme = appearance ?? (published?.scheme === "dark" ? "dark" : "light");
            const html = previewDocument(kind, source, previewTheme(scheme, published));
            const rendering = await withinTimeout(renderer.render({ html, width, appearance: scheme, timeoutMs: Math.max(1, previewTimeoutMs - 2_000) }), previewTimeoutMs);
            return { ...rendering, appearance: scheme };
          },
        }
      : {}),
  };
}
