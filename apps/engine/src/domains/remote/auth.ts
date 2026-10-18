import crypto from "node:crypto";
import { hostIsAllowed } from "../../platform/http/host";
import type { DeviceScope } from "@telar/engine-client";
import { ALL_SCOPES, requiredScope, roleOf } from "./scopes";
import { matchDevice, type PairedDevice, type RemoteFile, type RemoteStore } from "./store";

export const EXEMPT_PATHS = new Set(["/v2/ping", "/v2/pair", "/v2/identity"]);
const DEVICE_DOORS = new Set(["/v2/mcp"]);

export type Credentials = { authorization?: string | null; deviceCookie?: string | null; hostHeader?: string | null };
export type TicketCheck = (pathname: string, method: string, ticket: string | null | undefined) => { holder: string | null } | undefined;
export type AccessDecision =
  | { allow: true; deviceId?: string; scopes?: DeviceScope[] }
  | { allow: false; code: "cockpit_unauthorized" | "cockpit_forbidden" | "cockpit_misdirected" };

function isHostSecret(candidate: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || typeof candidate !== "string" || candidate.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(secret, "utf8"));
}

function identifyDevice(file: RemoteFile, credentials: Credentials): PairedDevice | undefined {
  const bearer = credentials.authorization?.match(/^Bearer\s+(tlr_[A-Za-z0-9_-]+)$/)?.[1];
  const candidate = bearer ?? credentials.deviceCookie;
  return candidate ? matchDevice(file, candidate) : undefined;
}

/** A paired device named by a bearer alone, never a cookie, so a browser page cannot ride a device's session into it. */
export function deviceForBearer(store: RemoteStore, authorization: string | undefined): { id: string; scopes: DeviceScope[] } | undefined {
  const device = identifyDevice(store.read(), { authorization: authorization ?? null });
  if (!device) return undefined;
  store.touchDevice(device.id);
  return { id: device.id, scopes: device.scopes };
}

export const isHostCaller = (credentials: Credentials, secret: string | undefined): boolean =>
  isHostSecret(credentials.hostHeader, secret) || isHostSecret(credentials.deviceCookie, secret);

function ticketDecision(file: RemoteFile, ticket: { holder: string | null } | undefined): AccessDecision {
  if (ticket?.holder === null) return { allow: true, scopes: ["read"] };
  const holder = ticket && file.devices.find((device) => device.id === ticket.holder);
  return holder ? { allow: true, deviceId: holder.id, scopes: ["read"] } : { allow: false, code: "cockpit_unauthorized" };
}

export function decideAccess(
  file: RemoteFile,
  request: Credentials & { pathname: string; method: string; host?: string | null; ticket?: string | null },
  hostSecret: string | undefined,
  checkTicket: TicketCheck = () => undefined,
): AccessDecision {
  if (!hostIsAllowed(request.host)) return { allow: false, code: "cockpit_misdirected" };
  if (DEVICE_DOORS.has(request.pathname)) return { allow: true };
  if (!file.requireAuth || EXEMPT_PATHS.has(request.pathname)) return { allow: true };
  if (isHostCaller(request, hostSecret)) return { allow: true, scopes: ALL_SCOPES };
  const device = identifyDevice(file, request);
  if (!device) return ticketDecision(file, checkTicket(request.pathname, request.method.toUpperCase(), request.ticket));
  if (!device.scopes.includes(requiredScope(request.method.toUpperCase(), request.pathname))) return { allow: false, code: "cockpit_forbidden" };
  return { allow: true, deviceId: device.id, scopes: device.scopes };
}
