import type { PairedDevice, RemoteFile } from "./store";

const seenAt = (device: PairedDevice): number => device.lastSeenAt ?? device.createdAt;
const sameDeviceKey = (device: PairedDevice): string => JSON.stringify([device.name, device.platform ?? null, device.identity?.address ?? null]);

// Before pairing recognised a returning device, each re-pair added a row; and turning pairing on from the
// desktop app paired the app with itself, stored as a platform-less "desktop" device.
function isHostSelfPairing(device: PairedDevice): boolean {
  return device.platform === undefined && device.identity?.kind === "desktop";
}

/** Drops host self-pairings and keeps the most recently seen of each set of duplicates. Runs once per file. */
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
