import { useEffect, useSyncExternalStore } from "react";
import { hosts } from "../hosts";
import { dataUri } from "./data-uri";

const RETRY_AFTER_MS = 60_000;
const images = new Map<string, string>();
const failedAt = new Map<string, number>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function load(hostId: string, projectId: string, key: string) {
  if (images.has(key) || loading.has(key) || Date.now() - (failedAt.get(key) ?? -Infinity) < RETRY_AFTER_MS) return;
  const host = hosts.get(hostId);
  if (!host) return;
  loading.add(key);
  void host
    .call(true, () => host.client.projectIcon(projectId, { format: "png" }))
    .then(({ data, contentType }) => images.set(key, dataUri(data, contentType || "image/png")))
    .catch(() => failedAt.set(key, Date.now()))
    .finally(() => {
      loading.delete(key);
      listeners.forEach((notify) => notify());
    });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A project's uploaded icon as an image URI, fetched once per icon revision; undefined until it arrives. */
export function useProjectIcon(hostId: string, projectId: string | undefined, icon: string | undefined): string | undefined {
  const key = projectId && icon ? `${hostId}/${projectId}/${icon}` : undefined;
  useEffect(() => {
    if (key && projectId) load(hostId, projectId, key);
  }, [key, hostId, projectId]);
  return useSyncExternalStore(subscribe, () => (key ? images.get(key) : undefined));
}
