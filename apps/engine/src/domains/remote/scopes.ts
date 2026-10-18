import { DEVICE_SCOPES, type DeviceRole, type DeviceScope } from "@telar/engine-client";

export const ALL_SCOPES: DeviceScope[] = [...DEVICE_SCOPES];

export function normaliseScopes(input: unknown): DeviceScope[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || !input.every((scope) => DEVICE_SCOPES.includes(scope))) return undefined;
  const highest = Math.max(...input.map((scope: DeviceScope) => DEVICE_SCOPES.indexOf(scope)));
  return DEVICE_SCOPES.slice(0, highest + 1);
}

export const scopesForRole = (role: unknown): DeviceScope[] => (role === "observer" ? ["read"] : ALL_SCOPES);
export const roleOf = (scopes: readonly DeviceScope[]): DeviceRole => (scopes.includes("write") ? "full" : "observer");

const ADMIN_ALWAYS = [/^\/v2\/remote(\/|$)/, /^\/v2\/hosts(\/|$)/];
const ADMIN_WRITES = [
  /^\/v2\/(plugins|computer-use|simulator-settings|provider-instances|provider-updates|workers|cleanup|storage)(\/|$)/,
];

export function requiredScope(method: string, pathname: string): DeviceScope {
  const path = pathname.startsWith("/api/") ? `/v2/${pathname.slice("/api/".length)}` : pathname;
  const reads = method === "GET" || method === "HEAD";
  if (ADMIN_ALWAYS.some((rule) => rule.test(path))) return "admin";
  if (!reads && ADMIN_WRITES.some((rule) => rule.test(path))) return "admin";
  return reads ? "read" : "write";
}
