import { BUILT_IN_DRIVERS, defaultInstanceIdForDriver, type ProviderDriverKind, type ProviderInstance, type ProviderProbe } from "@telar/engine-client";

/**
 * The providers a person can start work on: the built-ins whose own slot is switched on and whose CLI is found.
 * `keep` is the session's own provider, shown even when off. Until the instances load, only `keep` is offered.
 */
export function offeredDrivers(
  instances: readonly ProviderInstance[] | undefined,
  probes: readonly ProviderProbe[] | undefined,
  keep?: ProviderDriverKind,
): ProviderDriverKind[] {
  return BUILT_IN_DRIVERS.filter((driver) => {
    if (driver === keep) return true;
    const slot = instances?.find((instance) => instance.id === defaultInstanceIdForDriver(driver));
    if (!slot?.enabled) return false;
    return probes?.find((probe) => probe.instanceId === slot.id)?.installed !== false;
  });
}
