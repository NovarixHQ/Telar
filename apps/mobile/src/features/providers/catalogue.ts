import { useSyncExternalStore } from "react";
import type { ProviderDriverKind, ProviderInstance, ProviderModel } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

const values = new Map<string, unknown>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

/** One read per host and key, made the first time a menu needs it and shared by every menu after. */
function useHostRead<T>(host: HostConnection | undefined, key: string | undefined, read: (host: HostConnection) => Promise<T>): T | undefined {
  const full = host && key ? `${host.hostId}/${key}` : undefined;
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (host && full && !values.has(full) && !loading.has(full)) {
        loading.add(full);
        void host
          .call(true, () => read(host))
          .then((value) => values.set(full, value))
          .catch(() => undefined)
          .finally(() => {
            loading.delete(full);
            for (const notify of listeners) notify();
          });
      }
      return () => listeners.delete(listener);
    },
    () => (full ? (values.get(full) as T | undefined) : undefined),
  );
}

/** A provider instance's models. */
export function useModelCatalogue(host: HostConnection | undefined, driver: ProviderDriverKind | undefined, instanceId: string | undefined): ProviderModel[] | undefined {
  return useHostRead(host, driver && instanceId ? `models/${instanceId}` : undefined, (live) => live.client.modelCatalogue(driver!, { instanceId: instanceId! }).then(({ catalogue }) => catalogue.models));
}

export function useProviderInstances(host: HostConnection | undefined): ProviderInstance[] | undefined {
  return useHostRead(host, "instances", (live) => live.client.listProviderInstances().then(({ providerInstances }) => providerInstances));
}
