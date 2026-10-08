import { useSyncExternalStore } from "react";
import type { ProviderSkills } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

type Entry = { skills?: ProviderSkills; loading: boolean };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const EMPTY: Entry = { loading: false };

function load(host: HostConnection, sessionId: string, key: string): void {
  entries.set(key, { loading: true });
  void host
    .call(true, () => host.client.sessionSkills(sessionId))
    .then((skills) => entries.set(key, { skills, loading: false }))
    .catch(() => entries.delete(key))
    .finally(() => {
      for (const listener of listeners) listener();
    });
}

/** The session's skills and provider commands, read the first time a `/` or `$` is typed. */
export function useSessionSkills(host: HostConnection | undefined, sessionId: string, wanted: boolean): Entry {
  const key = host && wanted ? `${host.hostId}/${sessionId}` : undefined;
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (key && host && !entries.has(key)) load(host, sessionId, key);
      return () => listeners.delete(listener);
    },
    () => (key ? (entries.get(key) ?? EMPTY) : EMPTY),
  );
}
