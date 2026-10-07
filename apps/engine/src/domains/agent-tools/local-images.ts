// Adapted from T3 Code's HtmlRender (github.com/pingdotgg/t3code), MIT License, Copyright (c) 2026 T3 Tools Inc.
import fs from "node:fs";

const MIB = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * MIB;
const MAX_PAGE_BYTES = 25 * MIB;
const formatMib = (bytes: number) => `${(bytes / MIB).toFixed(1)} MiB`;

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};
const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES).join("|");
const LOCAL_IMAGE_PATTERN = new RegExp(
  String.raw`(["'\x60])(/(?!/)(?:(?!\1)[^\r\n]){0,2048}?\.(?:${IMAGE_EXTENSIONS}))\1` +
    String.raw`|url\(\s*(/(?!/)[^\s"'\x60()]{0,2048}?\.(?:${IMAGE_EXTENSIONS}))\s*\)`,
  "gid",
);

export const imagesNotFound = (paths: string[]) =>
  `These local images could not be read: ${paths.join(", ")}. Use absolute paths to existing image files, or remove them.`;
const imageTooLarge = (path: string, bytes: number) =>
  `${path} is ${formatMib(bytes)}; each local image must be at most ${formatMib(MAX_IMAGE_BYTES)}.`;
const pageTooLarge = (bytes: number) =>
  `With its images inlined the page is ${formatMib(bytes)}; the limit is ${formatMib(MAX_PAGE_BYTES)}. Use smaller images.`;

const findLocalImages = (html: string) =>
  Array.from(html.matchAll(LOCAL_IMAGE_PATTERN)).flatMap((match) => {
    const span = match.indices?.[2] ?? match.indices?.[3];
    return span ? [{ start: span[0], end: span[1], path: html.slice(span[0], span[1]) }] : [];
  });

const dataUriPrefix = (path: string) =>
  `data:${IMAGE_MIME_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream"};base64,`;

const base64Bytes = (bytes: number) => Math.ceil(bytes / 3) * 4;

// Judged by its bytes whatever the file is named, so a symlink or renamed file cannot carry a secret into a page.
function isImageBytes(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 12).toString("latin1");
  if (
    head.startsWith("\x89PNG") ||
    head.startsWith("\xff\xd8\xff") ||
    head.startsWith("GIF8") ||
    head.startsWith("\0\0\x01\0") ||
    (head.startsWith("BM") && head.slice(6, 10) === "\0\0\0\0") ||
    (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") ||
    /^ftyp(?:avif|avis|mif1)$/.test(head.slice(4, 12))
  ) {
    return true;
  }
  return hasSvgRoot(new TextDecoder().decode(bytes.subarray(0, 4096)));
}

const after = (text: string, token: string, from: number) => {
  const at = text.indexOf(token, from);
  return at === -1 ? -1 : at + token.length;
};

function hasSvgRoot(text: string): boolean {
  let at = 0;
  while (at !== -1) {
    while (/\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (text.slice(at, at + 9).toLowerCase() === "<!doctype") at = afterDoctype(text, at + 9);
    else return /^<svg[ \t\r\n/>]/.test(text.slice(at, at + 5));
  }
  return false;
}

function afterDoctype(text: string, from: number): number {
  let inSubset = false;
  let at = from;
  while (at !== -1 && at < text.length) {
    const char = text[at];
    if (char === '"' || char === "'") at = after(text, char, at + 1);
    else if (inSubset && text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (inSubset && text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (char === ">" && !inSubset) return at + 1;
    else {
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      at += 1;
    }
  }
  return -1;
}

async function readImage(path: string): Promise<Buffer | undefined> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of fs.createReadStream(path, { end: MAX_IMAGE_BYTES })) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  } catch {
    return undefined;
  }
}

export async function inlineLocalImages(html: string): Promise<{ html: string; missing: string[] }> {
  const references = findLocalImages(html);
  if (references.length === 0) return { html, missing: [] };
  const files = await Promise.all(
    [...new Set(references.map((reference) => reference.path))].map(async (path) => {
      const stats = await fs.promises.stat(path).catch(() => undefined);
      return { path, size: stats?.isFile() ? stats.size : undefined };
    }),
  );
  for (const file of files) if (file.size !== undefined && file.size > MAX_IMAGE_BYTES) throw new Error(imageTooLarge(file.path, file.size));
  const sizes = new Map(files.map((file) => [file.path, file.size]));
  const estimate = references.reduce((total, reference) => {
    const size = sizes.get(reference.path);
    return size === undefined ? total : total + dataUriPrefix(reference.path).length + base64Bytes(size) - Buffer.byteLength(reference.path);
  }, Buffer.byteLength(html));
  if (estimate > MAX_PAGE_BYTES) throw new Error(pageTooLarge(estimate));
  const dataUris = new Map<string, string>();
  let readBytes = 0;
  for (const file of files) {
    if (file.size === undefined) continue;
    const bytes = await readImage(file.path);
    if (!bytes || !isImageBytes(bytes)) continue;
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(imageTooLarge(file.path, bytes.byteLength));
    readBytes += base64Bytes(bytes.byteLength);
    if (readBytes > MAX_PAGE_BYTES) throw new Error(pageTooLarge(readBytes));
    dataUris.set(file.path, dataUriPrefix(file.path) + bytes.toString("base64"));
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const reference of references) {
    const dataUri = dataUris.get(reference.path);
    if (dataUri === undefined) continue;
    parts.push(html.slice(cursor, reference.start), dataUri);
    cursor = reference.end;
  }
  parts.push(html.slice(cursor));
  const inlined = parts.join("");
  const inlinedBytes = Buffer.byteLength(inlined);
  if (inlinedBytes > MAX_PAGE_BYTES) throw new Error(pageTooLarge(inlinedBytes));
  return { html: inlined, missing: files.filter((file) => !dataUris.has(file.path)).map((file) => file.path) };
}
