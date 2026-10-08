import { useSyncExternalStore } from "react";
import { Settings } from "react-native";
import { SettingsStore, type AppSettings } from "./store";

export const appSettings = new SettingsStore({ get: (key) => Settings.get(key), set: (values) => Settings.set(values) });

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(appSettings.subscribe, () => appSettings.current);
}
