/** A name safe to write as one file: no folders, never empty or a dot entry. */
export function fileName(name: string): string {
  const trimmed = name.replaceAll("/", "_").replaceAll(":", "_").trim();
  return !trimmed || trimmed === "." || trimmed === ".." ? "attachment" : trimmed;
}

/** The folder a sent attachment is kept in on this phone: one per computer, session and attachment. */
export const cacheFolder = (hostId: string, sessionId: string, attachmentId: string): string[] =>
  ["attachments", hostId, sessionId, attachmentId].map(encodeURIComponent);

/** Swift's bubble: the text, or "Image" for a message with neither text nor files; files alone draw only their tiles. */
export function bubbleShows(text: string, files: number): "text" | "image" | "none" {
  if (text.trim()) return "text";
  return files ? "none" : "image";
}
