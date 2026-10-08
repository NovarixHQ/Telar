import { HostRegistry, wakeOnForeground } from "../../platform/connection";
import type { PairedHost } from "./pairing";
import { loadHosts, saveHosts } from "./storage";

export const hosts = new HostRegistry();

const paired = new Map<string, PairedHost>();

export async function rememberHost(host: PairedHost): Promise<void> {
  paired.set(host.hostId, host);
  hosts.add(host);
  await saveHosts([...paired.values()]);
}

void loadHosts().then((stored) => {
  for (const host of stored) {
    if (paired.has(host.hostId)) continue;
    paired.set(host.hostId, host);
    hosts.add(host);
  }
});

wakeOnForeground(hosts);
