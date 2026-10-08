export type IdStore = { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> };

const KEY = "telar.clientId";

/** An upper-case v4 UUID, the shape of the Swift app's identifierForVendor. */
export function newClientId(randomByte: () => number = () => Math.floor(Math.random() * 256)): string {
  const bytes = Array.from({ length: 16 }, randomByte);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This install's id for the engine, created once and kept. The engine tells two devices with the same
 * name and address apart only by it, so without it this app and the Swift app take each other's token.
 */
export async function loadClientId(store: IdStore, create: () => string = newClientId): Promise<string> {
  const saved = await store.get(KEY);
  if (saved) return saved;
  const id = create();
  await store.set(KEY, id);
  return id;
}
