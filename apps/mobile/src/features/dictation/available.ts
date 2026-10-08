import { useSyncExternalStore } from "react";
import type { HostConnection } from "../../platform/connection";

const known = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Whether the host has dictation set up; asked once per host the first time a composer shows. */
export function useDictationAvailable(host: HostConnection | undefined): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (host && !known.has(host.hostId)) {
        known.set(host.hostId, false);
        void host
          .call(true, () => host.client.dictation())
          .then(({ dictation }) => known.set(host.hostId, dictation.provider !== "off" && dictation.configured))
          .catch(() => known.delete(host.hostId))
          .finally(() => {
            for (const notify of listeners) notify();
          });
      }
      return () => listeners.delete(listener);
    },
    () => (host ? known.get(host.hostId) === true : false),
  );
}
