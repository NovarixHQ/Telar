import os from "node:os";
import { isIP } from "node:net";

export type CockpitEndpoint = { kind: "loopback" | "lan" | "tailnet" | "magicdns"; label: string; url: string; qrSafe: boolean };

type NicMap = Record<string, Array<{ family: string | number; address: string; internal: boolean }> | undefined>;
type Listener = { host: string; port: number };

const WILDCARD = new Set(["0.0.0.0", "::"]);
const RANK: Record<CockpitEndpoint["kind"], number> = { loopback: 0, lan: 1, tailnet: 2, magicdns: 3 };

function isTailnetIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  return octets.length === 4 && octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127;
}

function hostEndpoint(address: string, port: number): CockpitEndpoint {
  const url = `http://${isIP(address) === 6 ? `[${address}]` : address}:${port}`;
  if (address === "127.0.0.1" || address === "::1" || address === "localhost") return { kind: "loopback", label: "This machine", url, qrSafe: false };
  const tailnet = isTailnetIpv4(address);
  return { kind: tailnet ? "tailnet" : "lan", label: tailnet ? "Tailscale IP" : "Local network", url, qrSafe: true };
}

export function listEndpoints(
  network: Listener | undefined,
  nics: NicMap = os.networkInterfaces() as NicMap,
  env: Record<string, string | undefined> = process.env,
): CockpitEndpoint[] {
  if (!network) return [];
  const addresses = WILDCARD.has(network.host)
    ? ["127.0.0.1", ...Object.values(nics).flatMap((entries) => (entries ?? []).filter((entry) => (entry.family === "IPv4" || entry.family === 4) && !entry.internal && !entry.address.startsWith("169.254.")).map((entry) => entry.address))]
    : [network.host];
  const endpoints = addresses.map((address) => hostEndpoint(address, network.port));
  const magicdns = env.TELAR_TAILSCALE_URL?.trim();
  if (magicdns?.startsWith("https://")) endpoints.push({ kind: "magicdns", label: "Tailscale HTTPS", url: magicdns.replace(/\/$/, ""), qrSafe: true });
  const unique = endpoints.filter((endpoint, index) => endpoints.findIndex((other) => other.url === endpoint.url) === index);
  return unique.sort((left, right) => RANK[left.kind] - RANK[right.kind]);
}

export function dialableAddresses(endpoints: readonly CockpitEndpoint[]): string[] {
  return endpoints.filter((endpoint) => endpoint.qrSafe).map((endpoint) => endpoint.url);
}

export function advertisedAddresses(endpoints: readonly CockpitEndpoint[]): string[] {
  const order: Record<CockpitEndpoint["kind"], number> = { tailnet: 0, magicdns: 1, lan: 2, loopback: 3 };
  return endpoints.filter((endpoint) => endpoint.qrSafe).sort((left, right) => order[left.kind] - order[right.kind]).map((endpoint) => endpoint.url);
}
