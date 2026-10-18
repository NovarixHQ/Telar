import type http from "node:http";

const DEVICE_COOKIE = "telar_device";
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function deviceCookieHeader(raw: string, request: http.IncomingMessage): string {
  const base = `${DEVICE_COOKIE}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
  return request.headers["x-forwarded-proto"] === "https" ? `${base}; Secure` : base;
}

export function readDeviceCookie(request: http.IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === DEVICE_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function cookieRequestIsSameOrigin(request: http.IncomingMessage): boolean {
  if (SAFE_METHODS.has((request.method ?? "GET").toUpperCase())) return true;
  try {
    const behindDevProxy = process.env.TELAR_DEV_PROXY === "1" ? request.headers["x-forwarded-host"] : undefined;
    return new URL(request.headers.origin ?? "").host === (behindDevProxy ?? request.headers.host);
  } catch {
    return false;
  }
}
