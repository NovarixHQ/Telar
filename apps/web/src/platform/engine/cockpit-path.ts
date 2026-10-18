import { COCKPIT_API } from "@telar/engine-client";

const SEGMENT = "[^/?]+";
const ANY = "*";

const OWN: [method: string, path: RegExp][] = [
  [ANY, /^\/v2\/(appearance|dictation|remote|remote\/pairing|provider-instances|claude-conversations)$/],
  [ANY, new RegExp(`^/v2/projects/${SEGMENT}/sessions$`)],
  ["GET", new RegExp(`^/v2/(health|identity|models|sessions/find|simulators/stream-ticket|projects/${SEGMENT}/files/raw|sessions/${SEGMENT}/(events|files/raw))$`)],
  ["POST", new RegExp(`^/v2/(hosts|pair|sessions/${SEGMENT}/(adopt|handoff|stop|requests/${SEGMENT})|sessions/${SEGMENT}/turns/${SEGMENT}/move)$`)],
  ["DELETE", /^\/v2\/remote\/devices$/],
];

export function cockpitPath(pathname: string, method = "GET"): string {
  if (!pathname.startsWith("/v2/")) return pathname;
  const path = pathname.replace(/\?.*$/, "");
  const own = OWN.some(([verb, pattern]) => (verb === ANY || verb === method) && pattern.test(path));
  return own ? `/api${pathname.slice("/v2".length)}` : `${COCKPIT_API}${pathname}`;
}
