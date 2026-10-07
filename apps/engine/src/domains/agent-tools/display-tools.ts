import crypto from "node:crypto";
import fs from "node:fs";
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

const INLINE = `Draw a visual artifact into your reply: html, svg, mermaid or markdown (a chart is html or svg). Best for a status, overview, comparison, diagram or chart; otherwise reply in plain text, and honour a preference for md or html files. Html has no network: inline every script, style and image. Check it with display_preview first. Same id revises.`;

const PREVIEW = `Render html, svg or mermaid offscreen in the current Look as display_inline would draw it, before publishing. Returns a screenshot, the content height, console errors and warnings with stacks, and failed loads. The person sees nothing.`;

const THEME_GUIDE = [
  "The source. Give this or path. Html and svg get the person's Look as CSS variables on :root, in hex, following Look changes live:",
  "--background (the canvas around the frame; transparent on a see-through Look), --foreground, --muted, --muted-foreground,",
  "--card, --card-foreground (raised surfaces), --border, --primary, --primary-foreground (solid buttons), --secondary, --secondary-foreground,",
  "--accent, --accent-foreground (hover surface), --success, --warning, --info, --destructive,",
  "--chart-1, --chart-2, --chart-3, --chart-4, --chart-5, --chart-6 (categorical series, legible on --background and --card), --code-background, --code-foreground, --code-comment,",
  "--code-keyword, --code-string, --code-number, --code-function, --radius, --font-sans, --font-mono.",
  "The base stylesheet sets html background, colour and font from these, body margin to 0, and hides the scrollbar; your own CSS overrides it. Mermaid takes the Look by itself.",
  "The page sits borderless on the reply's canvas, as wide as the reply column, with no frame or header around it: it is part of your reply.",
  "Use a fluid width with no outer card, border, banner title or horizontal padding on the outermost element. Give charts fixed pixel heights.",
  "Let content set the page's height: no 100vh or height:100% on html or body.",
].join(" ");

export const DISPLAY_BRIEFING =
  "When the person asks for a status, overview, comparison, diagram or chart, an inline artifact from display_inline (tool search loads it) is usually best; otherwise reply in plain text and honour a preference for md or html files. Check it with display_preview, publish with display_inline, then reply without restating what the page shows. The page is part of your reply: no outer card or title.";

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
        path: z.string().optional().describe("A file in the checkout holding the source, relative to its root."),
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
        path: z.string().optional().describe("A file in the checkout holding the source, relative to its root."),
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
          return err(`Could not preview it: ${failure(error)}`);
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

async function checkoutFile(cwd: string, target: string): Promise<{ resolved: string; relative: string; stats: fs.Stats }> {
  const inside = (root: string, candidate: string) => candidate.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
  const resolved = path.resolve(cwd, target);
  if (!inside(cwd, resolved)) throw new Error("the path is outside this session's checkout");
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(resolved);
  } catch {
    throw new Error("no such file in this session's checkout — write it first, then display it");
  }
  if (stats.isDirectory()) throw new Error("that path is a directory; name one file");
  if (!stats.isFile()) throw new Error("that path is not a regular file");
  if (!inside(await fs.promises.realpath(cwd), await fs.promises.realpath(resolved))) throw new Error("the path is outside this session's checkout");
  return { resolved, relative: path.relative(cwd, resolved).split(path.sep).join("/"), stats };
}

async function sourceBytes(cwd: string, source: { content?: string; path?: string }): Promise<Uint8Array> {
  let data: Uint8Array;
  if (source.path !== undefined) {
    const { resolved, stats } = await checkoutFile(cwd, source.path);
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
