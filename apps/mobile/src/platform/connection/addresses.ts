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

export type Probe = { address: string; identity?: HostIdentity };

export type ProbeTarget = { hostId: string; paired: readonly string[]; legacy?: true };

const trimmed = (address: string) => address.replace(/\/+$/, "");

async function pings(address: string, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<boolean> {
  const answer = (await (await fetch(`${address}/api/ping`, { signal })).json().catch(() => null)) as { ok?: unknown } | null;
  return answer?.ok === true;
}

/**
 * Asks every address for its identity at once and takes the best-ranked one that names `hostId`.
 * An address answered by another Mac counts as silent, so no token is ever sent to it.
 * Hosts from before 2026-10-09 can't name themselves, so they are trusted only on an address this phone paired with.
 */
export async function probe(addresses: readonly string[], target: ProbeTarget, fetch: typeof globalThis.fetch, clock: Clock, signal?: AbortSignal): Promise<Probe | undefined> {
  const paired = new Set(target.paired.map(trimmed));
  const answers = addresses.map(async (address): Promise<Probe | undefined> => {
    const limit = deadline(clock, PROBE_TIMEOUT_MS, signal);
    try {
      const response = await fetch(`${address}/api/identity`, { signal: limit.signal });
      const identity = HostIdentity.safeParse(await response.json().catch(() => null));
      if (identity.success) return identity.data.hostId === target.hostId || (target.legacy && paired.has(address)) ? { address, identity: identity.data } : undefined;
      return paired.has(address) && (await pings(address, fetch, limit.signal)) ? { address } : undefined;
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
