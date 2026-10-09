import { humanBytes } from "@telar/client/journal";

const BYTE_CAP = 20 * 1024 * 1024;
export const PREVIEW_CAP = 8 * 1024 * 1024;
export const TURN_CAP = 16;

export type Picked = { uri: string; name?: string | null; mimeType?: string | null; size?: number | null };

export type Intake = { file: { uri: string; name: string; mediaType: string } } | { refused: string };

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt" };

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

/** Picked or pasted files split into those cleared for attaching and the reasons the rest were refused. */
export function takeFiles(picked: Picked[], fallback: string): { files: { uri: string; name: string; mediaType: string }[]; refusals: string[] } {
  const taken = picked.map((item) => intake(item, fallback));
  return { files: taken.flatMap((item) => ("file" in item ? [item.file] : [])), refusals: taken.flatMap((item) => ("refused" in item ? [item.refused] : [])) };
}
