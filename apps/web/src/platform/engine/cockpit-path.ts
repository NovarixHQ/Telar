import { COCKPIT_API } from "@telar/engine-client";

const ANY = "*";

const OWN: [method: string, path: RegExp][] = [
  [ANY, /^\/v2\/(remote|remote\/pairing)$/],
  ["GET", /^\/v2\/(identity|simulators\/stream-ticket)$/],
  ["POST", /^\/v2\/(hosts|pair)$/],
  ["DELETE", /^\/v2\/remote\/devices$/],
];

export function cockpitPath(pathname: string, method = "GET"): string {
  if (!pathname.startsWith("/v2/")) return pathname;
  const path = pathname.replace(/\?.*$/, "");
  const own = OWN.some(([verb, pattern]) => (verb === ANY || verb === method) && pattern.test(path));
  return own ? `/api${pathname.slice("/v2".length)}` : `${COCKPIT_API}${pathname}`;
}
