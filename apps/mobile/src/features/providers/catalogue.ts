import { useSyncExternalStore } from "react";
import type { ProviderDriverKind, ProviderModel } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

type Entry = { models?: ProviderModel[]; loading: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const EMPTY: Entry = { loading: false };

function load(host: HostConnection, driver: ProviderDriverKind, instanceId: string, key: string): void {
  entries.set(key, { loading: true });
  void host
    .call(true, () => host.client.modelCatalogue(driver, { instanceId }))
    .then(({ catalogue }) => entries.set(key, { models: catalogue.models, loading: false }))
    .catch(() => entries.delete(key))
    .finally(() => {
      for (const listener of listeners) listener();
    });
}

/** A provider instance's models, read once per host when a menu first needs them. */
export function useModelCatalogue(host: HostConnection | undefined, driver: ProviderDriverKind | undefined, instanceId: string | undefined): ProviderModel[] | undefined {
  const key = host && driver && instanceId ? `${host.hostId}/${instanceId}` : undefined;
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (key && host && driver && instanceId && !entries.has(key)) load(host, driver, instanceId, key);
      return () => listeners.delete(listener);
    },
    () => (key ? (entries.get(key) ?? EMPTY) : EMPTY).models,
  );
}
