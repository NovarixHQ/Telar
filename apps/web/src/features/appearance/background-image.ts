const MAX_EDGE = 2048;
const MIN_EDGE = 512;
const MAX_BYTES = 2.5 * 1024 * 1024;
const QUALITIES = [0.82, 0.7, 0.58];

function isImageFile(file: { type?: string; name?: string }): boolean {
  if (typeof file.type === "string" && file.type.startsWith("image/")) return true;
  return typeof file.name === "string" && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.name);
}

function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, edge / longest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const base64Bytes = (dataUrl: string): number => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    return element;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImageFile(file: File): Promise<string> {
  if (!isImageFile(file)) throw new Error("That file is not an image.");
  const source = await decode(file).catch(() => {
    throw new Error("That image could not be read.");
  });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not draw the image.");
  try {
    for (let edge = MAX_EDGE; edge >= MIN_EDGE; edge = Math.round(edge * 0.75)) {
      const { width, height } = fitWithin(source.width, source.height, edge);
      canvas.width = width;
      canvas.height = height;
      context.drawImage(source, 0, 0, width, height);
      for (const quality of QUALITIES) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.startsWith("data:image/") && base64Bytes(dataUrl) <= MAX_BYTES) return dataUrl;
      }
    }
  } finally {
    if ("close" in source && typeof source.close === "function") source.close();
  }
  throw new Error("That image is too large to store, even shrunk.");
}
