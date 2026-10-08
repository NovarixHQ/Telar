const BYTE_CAP = 20 * 1024 * 1024;
export const PREVIEW_CAP = 8 * 1024 * 1024;
export const TURN_CAP = 16;

export type Picked = { uri: string; name?: string | null; mimeType?: string | null; size?: number | null };

export type Intake = { file: { uri: string; name: string; mediaType: string } } | { refused: string };

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt" };

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** A picked file's name, with an extension from its type when it has none. */
function fileName(suggested: string | null | undefined, mediaType: string, fallback: string): string {
  const extension = EXTENSION[mediaType] ?? mediaType.split("/")[1]?.split(/[+;]/)[0] ?? "dat";
  const trimmed = suggested?.trim();
  if (!trimmed) return `${fallback}.${extension}`;
  return /\.[^./]+$/.test(trimmed) ? trimmed : `${trimmed}.${extension}`;
}

/** Whether a picked file can be attached, under the Swift app's 20 MB cap. */
export function intake(picked: Picked, fallback: string): Intake {
  const mediaType = picked.mimeType || "application/octet-stream";
  const name = fileName(picked.name, mediaType, fallback);
  if (picked.size === 0) return { refused: `${name} came through empty.` };
  if (picked.size && picked.size > BYTE_CAP) return { refused: `${name} is ${humanBytes(picked.size)} — attachments stop at ${humanBytes(BYTE_CAP)}.` };
  return { file: { uri: picked.uri, name, mediaType } };
}

export function attachmentSymbol(mediaType: string): string {
  if (mediaType.startsWith("image/")) return "photo";
  if (mediaType.startsWith("video/")) return "film";
  if (mediaType.startsWith("audio/")) return "waveform";
  if (mediaType === "application/pdf") return "doc.richtext";
  if (mediaType.startsWith("text/")) return "doc.text";
  return "doc";
}
