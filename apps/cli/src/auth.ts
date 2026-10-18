import { DEVICE_SCOPES, type DeviceScope } from "@telar/engine-client";
import { connect } from "./link";
import { UsageError, type Io } from "./io";

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

export function parseDuration(raw: string): number {
  const match = /^(\d+)([mhdw])$/.exec(raw.trim());
  const ms = match ? Number(match[1]) * UNITS[match[2]!]! : 0;
  if (ms <= 0 || ms > 365 * UNITS.d!) throw new UsageError("--expires takes a duration like 30m, 12h, 7d or 2w, at most a year.");
  return ms;
}

export function parseScopes(raw: string): DeviceScope[] {
  const scopes = raw.split(",").map((scope) => scope.trim());
  if (!scopes.every((scope): scope is DeviceScope => (DEVICE_SCOPES as readonly string[]).includes(scope))) {
    throw new UsageError("--scopes takes a list from read, write, admin.");
  }
  return scopes;
}

const when = (at: number | undefined): string => (at ? new Date(at).toISOString().slice(0, 16).replace("T", " ") : "-");

export type AuthOptions = { home: string; action: string | undefined; id?: string; allOthers: boolean; keep?: string };

export async function auth(options: AuthOptions, io: Io): Promise<number> {
  const client = await connect(options.home);
  if (options.action === "list") {
    const { devices } = await client.remoteState();
    if (!devices.length) io.out("No paired devices.");
    for (const device of devices) {
      io.out([device.id, device.name, device.scopes.join(","), `seen ${when(device.lastSeenAt)}`, `expires ${when(device.expiresAt)}`].join("  "));
    }
    return 0;
  }
  if (options.action === "revoke") {
    if (options.allOthers) {
      const { revoked } = await client.revokeOtherDevices(options.keep);
      io.out(`Revoked ${revoked} ${revoked === 1 ? "session" : "sessions"}.`);
      return 0;
    }
    if (!options.id) throw new UsageError("Name the session to revoke, or pass --all-others.");
    await client.revokeDevice(options.id);
    io.out("Revoked.");
    return 0;
  }
  throw new UsageError("Usage: telar auth session list | revoke <id> | revoke --all-others [--keep <id>]");
}
