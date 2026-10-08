import { useEffect, useSyncExternalStore } from "react";
import { hosts } from "../hosts";

const RETRY_AFTER_MS = 60_000;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function dataUri(bytes: Uint8Array, contentType: string): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b, c] = [bytes[index]!, bytes[index + 1], bytes[index + 2]];
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64[(chunk >> 18) & 63]! + BASE64[(chunk >> 12) & 63]! + (b === undefined ? "=" : BASE64[(chunk >> 6) & 63]!) + (c === undefined ? "=" : BASE64[chunk & 63]!);
  }
  return `data:${contentType};base64,${out}`;
}

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
