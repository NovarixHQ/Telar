import { HostIdentity, parsePairingUrl } from "@telar/engine-client";
import type { HostRecord } from "../../platform/connection";

export type PairedHost = HostRecord & { deviceId: string };

export type ThisDevice = { name?: string; tablet: boolean; clientId?: string };

export type PairingOutcome = { ok: true; host: PairedHost } | { ok: false; message: string };

const NOT_A_LINK = "That doesn't look like a Telar pairing link.";
const UNREACHABLE =
  "Couldn't reach that computer. Check that this phone is on the same Wi-Fi, or that Tailscale is on for a 100.x address.";
const TOO_OLD = "Telar on that computer is too old to pair with this app. Update it and try again.";

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** Checks which Mac the link points at, then spends its one-time code for a device token. */
export async function pair(link: string, device: ThisDevice, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<PairingOutcome> {
  const parsed = parsePairingUrl(link);
  if (!parsed) return { ok: false, message: NOT_A_LINK };
  let identity: HostIdentity;
  try {
    const answer = HostIdentity.safeParse(await json(await fetch(`${parsed.baseUrl}/api/identity`)));
    if (!answer.success) return { ok: false, message: TOO_OLD };
    identity = answer.data;
  } catch {
    return { ok: false, message: UNREACHABLE };
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
    return { ok: false, message: UNREACHABLE };
  }
  const body = (await json(response)) as { deviceToken?: unknown; deviceId?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || typeof body?.deviceToken !== "string" || typeof body.deviceId !== "string") {
    const reason = body?.error?.message;
    return { ok: false, message: typeof reason === "string" ? reason : `That computer refused the pairing (status ${response.status}).` };
  }
  return {
    ok: true,
    host: {
      hostId: identity.hostId,
      name: identity.name ?? new URL(parsed.baseUrl).hostname,
      token: body.deviceToken,
      deviceId: body.deviceId,
      paired: [parsed.baseUrl],
    },
  };
}
