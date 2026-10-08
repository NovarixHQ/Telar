import { HostIdentity } from "@telar/engine-client";
import { deadline, type Clock } from "./clock";

export const PROBE_TIMEOUT_MS = 2_500;

function isTailnet(address: string): boolean {
  const host = address.replace(/^https?:\/\//, "").split(/[:/]/)[0] ?? "";
  if (host.endsWith(".ts.net")) return true;
  const [first, second] = host.split(".").map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

/** Tailnet before LAN, the paired address before an advertised one of the same kind, no duplicates. */
export function rankAddresses(paired: readonly string[], advertised: readonly string[]): string[] {
  const unique = [...new Set([...paired, ...advertised].map((address) => address.replace(/\/+$/, "")))];
  return [...unique.filter(isTailnet), ...unique.filter((address) => !isTailnet(address))];
}

export type Probe = { address: string; identity: HostIdentity };

/**
 * Asks every address for its identity at once and takes the best-ranked one that names `hostId`.
 * An address answered by another Mac counts as silent, so no token is ever sent to it.
 */
export async function probe(addresses: readonly string[], hostId: string, fetch: typeof globalThis.fetch, clock: Clock, signal?: AbortSignal): Promise<Probe | undefined> {
  const answers = addresses.map(async (address): Promise<Probe | undefined> => {
    const limit = deadline(clock, PROBE_TIMEOUT_MS, signal);
    try {
      const response = await fetch(`${address}/api/identity`, { signal: limit.signal });
      const identity = HostIdentity.safeParse(await response.json());
      return identity.success && identity.data.hostId === hostId ? { address, identity: identity.data } : undefined;
    } catch {
      return undefined;
    } finally {
      limit.clear();
    }
  });
  for (const answer of answers) {
    const found = await answer;
    if (found) return found;
  }
  return undefined;
}
