const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function dataUri(bytes: Uint8Array, contentType: string): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b, c] = [bytes[index]!, bytes[index + 1], bytes[index + 2]];
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(chunk >> 18) & 63]! + BASE64[(chunk >> 12) & 63]! + (b === undefined ? "=" : BASE64[(chunk >> 6) & 63]!) + (c === undefined ? "=" : BASE64[chunk & 63]!);
  }
  return `data:${contentType};base64,${out}`;
}
