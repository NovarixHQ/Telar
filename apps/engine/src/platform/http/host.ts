import net from "node:net";
import os from "node:os";

const machine = os.hostname().toLowerCase().replace(/\.local$/, "");

function hostName(header: string): string | undefined {
  const match = /^(?:\[([0-9a-f:.]+)\]|([^:[\]]+))(?::\d{1,5})?$/i.exec(header.trim());
  return (match?.[1] ?? match?.[2])?.toLowerCase().replace(/\.$/, "") || undefined;
}

// Rebinding pages reach us under a DNS name, so IP literals pass; only Tailscale issues `.ts.net` names; browsers always send a Host.
export function hostIsAllowed(header: string | null | undefined): boolean {
  if (header === undefined || header === null) return true;
  const name = hostName(header);
  if (!name) return false;
  if (net.isIP(name)) return true;
  return name === "localhost" || name.endsWith(".localhost") || name === machine || name === `${machine}.local` || name.endsWith(".ts.net");
}
