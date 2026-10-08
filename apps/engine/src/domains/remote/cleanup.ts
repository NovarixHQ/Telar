import type { PairedDevice, RemoteFile } from "./store";

const seenAt = (device: PairedDevice): number => device.lastSeenAt ?? device.createdAt;
const sameDeviceKey = (device: PairedDevice): string => JSON.stringify([device.name, device.platform ?? null, device.identity?.address ?? null]);

function isHostSelfPairing(device: PairedDevice): boolean {
  return device.platform === undefined && device.identity?.kind === "desktop";
}

export function cleanUpPairings(file: RemoteFile): boolean {
  if (file.pairingsCleaned) return false;
  const groups = new Map<string, PairedDevice[]>();
  for (const device of file.devices.filter((each) => !isHostSelfPairing(each))) {
    groups.set(sameDeviceKey(device), [...(groups.get(sameDeviceKey(device)) ?? []), device]);
  }
  const kept = new Set<PairedDevice>();
  for (const group of groups.values()) {
    const clientIds = new Set(group.map((device) => device.clientId).filter(Boolean));
    if (clientIds.size > 1) group.forEach((device) => kept.add(device));
    else kept.add(group.reduce((latest, device) => (seenAt(device) > seenAt(latest) ? device : latest)));
  }
  file.devices = file.devices.filter((device) => kept.has(device));
  file.pairingsCleaned = true;
  return true;
}
