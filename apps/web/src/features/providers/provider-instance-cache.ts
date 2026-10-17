"use client";

import { useEffect, useState } from "react";
import { defaultInstanceIdForDriver, type ProviderDriverKind, type ProviderInstance, type ProviderProbe } from "@telar/engine-client";
import { offeredDrivers } from "@telar/client/providers";
import { createEngineApi } from "@/platform/engine";

const api = createEngineApi();

const PROVIDER_INSTANCES_CHANGED_EVENT = "telar:provider-instances";

export function announceProviderInstancesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROVIDER_INSTANCES_CHANGED_EVENT));
}

type Read = { instances: ProviderInstance[]; probes: ProviderProbe[] };

let cached: Read | undefined;
let inFlight: Promise<Read> | undefined;

function readProviderInstances(): Promise<Read> {
  if (cached) return Promise.resolve(cached);
  const pending =
    inFlight ??
    api
      .providerInstances()
      .then((answer) => {
        cached = { instances: answer.providerInstances, probes: answer.probes };
        return cached;
      })
      .catch((): Read => ({ instances: [], probes: [] }))
      .finally(() => {
        inFlight = undefined;
      });
  inFlight = pending;
  return pending;
}

export function forgetProviderInstances(): void {
  cached = undefined;
}

function useProviderRead(): Read | undefined {
  const [read, setRead] = useState<Read | undefined>(cached);

  useEffect(() => {
    let live = true;
    const load = () =>
      void readProviderInstances().then((next) => {
        if (live) setRead(next);
      });
    load();
    const invalidate = () => {
      forgetProviderInstances();
      load();
    };
    window.addEventListener(PROVIDER_INSTANCES_CHANGED_EVENT, invalidate);
    return () => {
      live = false;
      window.removeEventListener(PROVIDER_INSTANCES_CHANGED_EVENT, invalidate);
    };
  }, []);

  return read;
}

/** The providers a new session can start on; `keep` is the session's own, shown even when off. */
export function useOfferedDrivers(keep?: ProviderDriverKind): ProviderDriverKind[] {
  const read = useProviderRead();
  return offeredDrivers(read?.instances, read?.probes, keep);
}

export function useProviderInstance(
  id: string | undefined,
  driver: ProviderDriverKind | undefined,
): ProviderInstance | undefined {
  const instances = useProviderRead()?.instances;
  if (!instances) return undefined;
  const named = instances.find((instance) => instance.id === id);
  if (named) return named;
  return driver ? instances.find((instance) => instance.id === defaultInstanceIdForDriver(driver)) : undefined;
}
