import net from "node:net";
import os from "node:os";

const machine = os.hostname().toLowerCase().replace(/\.local$/, "");

function hostName(header: string): string | undefined {
  const match = /^(?:\[([0-9a-f:.]+)\]|([^:[\]]+))(?::\d{1,5})?$/i.exec(header.trim());
  return (match?.[1] ?? match?.[2])?.toLowerCase().replace(/\.$/, "") || undefined;
}

/**
 * Whether a Host header names this machine, so a DNS-rebinding page is refused. A missing header passes: browsers always send one.
 * IP literals pass because a rebinding page always reaches us under a name; `.ts.net` names are issued only by Tailscale.
 */
export function hostIsAllowed(header: string | null | undefined): boolean {
  if (header === undefined || header === null) return true;
  const name = hostName(header);
  if (!name) return false;
  if (net.isIP(name)) return true;
  return name === "localhost" || name.endsWith(".localhost") || name === machine || name === `${machine}.local` || name.endsWith(".ts.net");
}
