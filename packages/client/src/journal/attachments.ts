export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** The SF Symbol for an attachment's type, as the Swift app draws it. */
export function attachmentSymbol(mediaType: string): string {
  if (mediaType.startsWith("image/")) return "photo";
  if (mediaType.startsWith("video/")) return "film";
  if (mediaType.startsWith("audio/")) return "waveform";
  if (mediaType === "application/pdf") return "doc.richtext";
  if (mediaType.startsWith("text/")) return "doc.text";
  return "doc";
}
