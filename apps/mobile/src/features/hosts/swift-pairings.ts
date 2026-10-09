import type { PairedHost } from "./pairing";

export type SwiftStore = { hosts(): string | null; token(account: string): string | null };

export type AdoptDeps = {
  /** Null where the native reader is missing, so a later build can still adopt. */
  store: SwiftStore | null;
  done(): boolean;
  markDone(): void;
  save(hosts: PairedHost[]): Promise<void>;
};

type SwiftHost = { id?: unknown; name?: unknown; baseURLString?: unknown; addresses?: unknown; pairedURLString?: unknown };

const isHttp = (value: unknown): value is string => typeof value === "string" && /^https?:\/\/[^/]/.test(value);

/**
 * The Swift app's hosts, keyed `host_<its uuid>` so push registrations and muted links it left behind still match.
 * They are `legacy`: Swift never kept the engine's host id, so any Telar answering on a saved address is that host.
 */
export function swiftHosts(store: SwiftStore): PairedHost[] {
  let rows: unknown;
  try {
    rows = JSON.parse(store.hosts() ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: SwiftHost) => {
    if (typeof row?.id !== "string" || !isHttp(row.baseURLString)) return [];
    const extra = Array.isArray(row.addresses) ? row.addresses.filter(isHttp) : [];
    const paired = [...new Set([...(isHttp(row.pairedURLString) ? [row.pairedURLString] : []), row.baseURLString, ...extra])];
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : new URL(row.baseURLString).hostname;
    const token = store.token(`deviceToken.${row.id.toUpperCase()}`) ?? "";
    return [{ hostId: `host_${row.id.toLowerCase()}`, name, token, paired, deviceId: "", legacy: true as const }];
  });
}

/** Adds the Swift app's pairings once, beside what this app stored, and leaves the Swift app's own data as it was. */
export async function adoptSwiftPairings(stored: PairedHost[], deps: AdoptDeps): Promise<PairedHost[]> {
  if (!deps.store || deps.done()) return stored;
  const found = swiftHosts(deps.store).filter((host) => !stored.some((known) => known.hostId === host.hostId));
  const hosts = [...stored, ...found];
  if (found.length > 0) await deps.save(hosts);
  deps.markDone();
  return hosts;
}
