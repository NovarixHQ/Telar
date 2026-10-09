import { HostIdentity, parsePairingUrl } from "@telar/engine-client";
import type { HostRecord } from "../../platform/connection";
import { newClientId } from "./client-id";

export type PairedHost = HostRecord & { deviceId: string };

export type ThisDevice = { name?: string; tablet: boolean; clientId?: string };

export type PairingOutcome = { ok: true; host: PairedHost } | { ok: false; message: string };

const NOT_A_LINK = "That doesn't look like a Telar pairing link.";
const unreachable = (baseUrl: string) =>
  `Couldn't reach ${new URL(baseUrl).hostname}. If that's a local address, check this phone is on the same wifi and Telar may use the local network; if it's a 100.x address, check Tailscale is connected on this phone.`;
const NOT_TELAR = "That address answered, but not as Telar. Check the link and try again.";

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Checks which Mac the link points at, then spends its one-time code for a device token. */
export async function pair(link: string, device: ThisDevice, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<PairingOutcome> {
  const parsed = parsePairingUrl(link);
  if (!parsed) return { ok: false, message: NOT_A_LINK };
  let identity: HostIdentity | undefined;
  try {
    const answer = HostIdentity.safeParse(await json(await fetch(`${parsed.baseUrl}/api/identity`)));
    identity = answer.success ? answer.data : undefined;
    if (!identity && (await json(await fetch(`${parsed.baseUrl}/api/ping`)) as { ok?: unknown } | null)?.ok !== true) return { ok: false, message: NOT_TELAR };
  } catch {
    return { ok: false, message: unreachable(parsed.baseUrl) };
  }
  let response: Response;
  try {
    response = await fetch(`${parsed.baseUrl}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: parsed.token,
        platform: "ios",
        kind: device.tablet ? "tablet" : "phone",
        machine: device.tablet ? "iPad" : "iPhone",
        os: device.tablet ? "iPadOS" : "iOS",
        ...(device.name ? { deviceName: device.name } : {}),
        ...(device.clientId ? { clientId: device.clientId } : {}),
      }),
    });
  } catch {
    return { ok: false, message: unreachable(parsed.baseUrl) };
  }
  const body = (await json(response)) as { deviceToken?: unknown; deviceId?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || typeof body?.deviceToken !== "string" || typeof body.deviceId !== "string") {
    const reason = body?.error?.message;
    return { ok: false, message: typeof reason === "string" ? reason : `That computer refused the pairing (status ${response.status}).` };
  }
  const host = { token: body.deviceToken, deviceId: body.deviceId, paired: [parsed.baseUrl] };
  if (identity) return { ok: true, host: { ...host, hostId: identity.hostId, name: identity.name ?? new URL(parsed.baseUrl).hostname } };
  const health = (await fetch(`${parsed.baseUrl}/api/health`, { headers: { authorization: `Bearer ${body.deviceToken}` } }).then(json, () => null)) as { hostname?: unknown } | null;
  const name = typeof health?.hostname === "string" ? health.hostname.replace(/\.(local|lan)$/, "") : new URL(parsed.baseUrl).hostname;
  return { ok: true, host: { ...host, hostId: `host_${newClientId().toLowerCase()}`, name, legacy: true } };
}

/** A host paired before it could name itself gets a new id each pairing, so a newer pairing on one of its addresses replaces it. */
export function supersededBy(host: HostRecord, known: readonly HostRecord[]): HostRecord[] {
  const addresses = new Set(host.paired);
  return known.filter((other) => other.legacy && other.hostId !== host.hostId && other.paired.some((address) => addresses.has(address)));
}
