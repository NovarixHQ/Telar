import type http from "node:http";
import type { DeviceIdentity } from "@telar/engine-client";
import { thisComputerName } from "../../platform/http/host";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function cleanDeclared(value: unknown, limit = 64): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = [...value].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char)).join("").trim().replace(/\s+/g, " ");
  return stripped.length === 0 ? undefined : stripped.slice(0, limit);
}

function cleanKind(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length === 0 ? undefined : slug.slice(0, 32);
}

function sniffUserAgent(header: string | undefined): { kind: string; client?: string; os?: string } {
  const ua = (header ?? "").slice(0, 400);
  if (ua.length === 0) return { kind: "unknown" };
  const client = /\bEdg\//.test(ua) ? "Edge" : /\bOPR\//.test(ua) ? "Opera" : /\bFirefox\//.test(ua) ? "Firefox" : /\bChrome\//.test(ua) ? "Chrome" : /\bSafari\//.test(ua) ? "Safari" : undefined;
  const os = /\biPhone\b/.test(ua) ? "iOS" : /\biPad\b/.test(ua) ? "iPadOS" : /\bAndroid\b/.test(ua) ? "Android" : /\bMac OS X\b/.test(ua) ? "macOS" : /\bWindows NT\b/.test(ua) ? "Windows" : /\bLinux\b/.test(ua) ? "Linux" : undefined;
  const kind = /\biPhone\b|\bAndroid\b.*\bMobile\b/.test(ua) ? "phone" : /\biPad\b|\bTablet\b/.test(ua) ? "tablet" : client ? "browser" : "unknown";
  return { kind, ...(client ? { client } : {}), ...(os ? { os } : {}) };
}

function peerAddress(request: http.IncomingMessage): string | undefined {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const candidate = forwarded || String(request.headers["x-real-ip"] ?? "").trim() || request.socket.remoteAddress;
  return candidate && candidate.length <= 64 ? candidate : undefined;
}

const originOf = (request: http.IncomingMessage): string | undefined => request.headers.host?.slice(0, 64) || undefined;

export function describeDevice(identity: DeviceIdentity, declaredName?: string): string {
  const name = cleanDeclared(declaredName);
  if (name) return name;
  const kind = identity.kind === "unknown" ? undefined : identity.kind.split("-").filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
  return [identity.client ?? kind, identity.machine ?? identity.os].filter(Boolean).join(" on ") || "Unknown device";
}

/** What the engine can tell about the caller itself; anything the client declares wins over the sniffed user agent. */
export function observeIdentity(request: http.IncomingMessage, declared: { kind?: unknown; client?: unknown; machine?: unknown; os?: unknown } = {}): DeviceIdentity {
  const sniffed = sniffUserAgent(request.headers["user-agent"]);
  const client = cleanDeclared(declared.client) ?? sniffed.client;
  const platformOs = cleanDeclared(declared.os) ?? sniffed.os;
  const dialledLoopback = LOOPBACK.has((request.headers.host ?? "").replace(/:\d+$/, ""));
  const machine = cleanDeclared(declared.machine) ?? (dialledLoopback ? thisComputerName() : undefined);
  const address = peerAddress(request);
  const origin = originOf(request);
  return {
    kind: cleanKind(declared.kind) ?? sniffed.kind,
    ...(client ? { client } : {}),
    ...(machine ? { machine } : {}),
    ...(platformOs ? { os: platformOs } : {}),
    ...(address ? { address } : {}),
    ...(origin ? { origin } : {}),
  };
}
