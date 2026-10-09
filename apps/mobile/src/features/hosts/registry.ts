import { HostRegistry } from "../../platform/connection";
import { wakeOnForeground } from "../../platform/connection/app-wakeups";
import { supersededBy, type PairedHost } from "./pairing";
import { loadHosts, saveHosts } from "./storage";

export const hosts = new HostRegistry();

const paired = new Map<string, PairedHost>();

export const pairedHost = (hostId: string): PairedHost | undefined => paired.get(hostId);

export async function rememberHost(host: PairedHost): Promise<void> {
  for (const other of supersededBy(host, [...paired.values()])) {
    paired.delete(other.hostId);
    hosts.remove(other.hostId);
  }
  paired.set(host.hostId, host);
  hosts.add(host);
  await saveHosts([...paired.values()]);
}

export async function renameHost(hostId: string, name: string): Promise<void> {
  const host = paired.get(hostId);
  const trimmed = name.trim();
  if (host && trimmed && trimmed !== host.name) await rememberHost({ ...host, name: trimmed });
}

/** Drops this phone's credential but keeps the computer, which then asks to be paired again. */
export async function forgetPairing(hostId: string): Promise<void> {
  const host = paired.get(hostId);
  if (host) await rememberHost({ ...host, token: "" });
}

export async function forgetHost(hostId: string): Promise<void> {
  paired.delete(hostId);
  hosts.remove(hostId);
  await saveHosts([...paired.values()]);
}

/** Settles once the stored hosts are in the registry, so a launch link can name one. */
export const hostsLoaded: Promise<void> = loadHosts().then((stored) => {
  for (const host of stored) {
    if (paired.has(host.hostId)) continue;
    paired.set(host.hostId, host);
    hosts.add(host);
  }
});

wakeOnForeground(hosts);
