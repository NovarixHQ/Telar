import * as SecureStore from "expo-secure-store";
import type { PairedHost } from "./pairing";

const KEY = "telar.hosts";

const isPairedHost = (value: unknown): value is PairedHost => {
  const host = value as Partial<PairedHost> | null;
  return typeof host?.hostId === "string" && typeof host.token === "string" && typeof host.name === "string" && Array.isArray(host.paired);
};

export async function loadHosts(): Promise<PairedHost[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPairedHost) : [];
  } catch {
    return [];
  }
}

export async function saveHosts(hosts: PairedHost[]): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(hosts), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}
