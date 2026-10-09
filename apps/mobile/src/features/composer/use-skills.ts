import { useSyncExternalStore } from "react";
import type { ProviderDriverKind, ProviderSkills } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

type Entry = { skills?: ProviderSkills; loading: boolean };

/** Whose skills: a running session's, or a project's for the agent a new session will start on. */
export type SkillsSource = { sessionId: string; driver?: ProviderDriverKind } | { projectId: string; driver: ProviderDriverKind };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const EMPTY: Entry = { loading: false };

const keyOf = (hostId: string, source: SkillsSource) =>
  "sessionId" in source ? `${hostId}/session:${source.sessionId}:${source.driver ?? ""}` : `${hostId}/project:${source.projectId}:${source.driver}`;

function load(host: HostConnection, source: SkillsSource, key: string): void {
  entries.set(key, { loading: true });
  void host
    .call(true, () => ("sessionId" in source ? host.client.sessionSkills(source.sessionId) : host.client.projectSkills(source.projectId, source.driver)))
    .then((skills) => entries.set(key, { skills, loading: false }))
    .catch(() => entries.delete(key))
    .finally(() => {
      for (const listener of listeners) listener();
    });
}

/** The skills and provider commands, read the first time a `/` or `$` is typed; a provider switch reads them again. */
export function useSkills(host: HostConnection | undefined, source: SkillsSource | undefined, wanted: boolean): Entry {
  const key = host && source && wanted ? keyOf(host.hostId, source) : undefined;
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (key && host && source && !entries.has(key)) load(host, source, key);
      return () => listeners.delete(listener);
    },
    () => (key ? (entries.get(key) ?? EMPTY) : EMPTY),
  );
}
