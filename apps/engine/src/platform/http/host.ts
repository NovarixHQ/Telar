import { execFileSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

function scutil(key: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try { return execFileSync("/usr/sbin/scutil", ["--get", key], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }); } catch { return undefined; }
}

function dnsLabel(name: string): string {
  return name.trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function machineNames(hostname: string, localHostName?: string, computerName?: string): Set<string> {
  const bases = [hostname.trim().toLowerCase().replace(/\.local\.?$/, "")];
  for (const name of [localHostName, computerName]) if (name?.trim()) bases.push(dnsLabel(name));
  return new Set(bases.filter(Boolean).flatMap(base => [base, `${base}.local`]));
}

const machine = machineNames(os.hostname(), scutil("LocalHostName"), scutil("ComputerName"));

function hostName(header: string): string | undefined {
  const match = /^(?:\[([0-9a-f:.]+)\]|([^:[\]]+))(?::\d{1,5})?$/i.exec(header.trim());
  return (match?.[1] ?? match?.[2])?.toLowerCase().replace(/\.$/, "") || undefined;
}

// Rebinding pages reach us under a DNS name, so IP literals pass; only Tailscale issues `.ts.net` names; browsers always send a Host.
export function hostIsAllowed(header: string | null | undefined, names: ReadonlySet<string> = machine): boolean {
  if (header === undefined || header === null) return true;
  const name = hostName(header);
  if (!name) return false;
  if (net.isIP(name)) return true;
  return name === "localhost" || name.endsWith(".localhost") || names.has(name) || name.endsWith(".ts.net");
}
