import { normalizeBaseUrl } from "@telar/engine-client";

export interface Host {
  id: string;
  name: string;
  baseUrl: string;
  deviceToken: string;
  daemonId?: string;
  addedAt: number;
}

export interface HostsFile {
  version: 1;
  hosts: Host[];
}

export function defaultHostName(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    return url.port && url.port !== defaultPort ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return baseUrl;
  }
}

export type Upsert = { kind: "added"; host: Host } | { kind: "replaced"; host: Host };

export function upsertHost(
  hosts: readonly Host[],
  input: { baseUrl: string; deviceToken: string; name?: string; daemonId?: string },
  now: number,
  mintId: () => string,
): { hosts: Host[]; result: Upsert } {
  const normalized = normalizeBaseUrl(input.baseUrl) ?? input.baseUrl;
  const index = hosts.findIndex((host) => normalizeBaseUrl(host.baseUrl) === normalized);
  if (index >= 0) {
    const existing = hosts[index]!;
    const host: Host = {
      ...existing,
      baseUrl: normalized,
      deviceToken: input.deviceToken,
      ...(input.daemonId ? { daemonId: input.daemonId } : {}),
      ...(input.name ? { name: input.name } : {}),
    };
    const next = hosts.slice();
    next[index] = host;
    return { hosts: next, result: { kind: "replaced", host } };
  }
  const host: Host = {
    id: mintId(),
    name: input.name?.trim() || defaultHostName(normalized),
    baseUrl: normalized,
    deviceToken: input.deviceToken,
    ...(input.daemonId ? { daemonId: input.daemonId } : {}),
    addedAt: now,
  };
  return { hosts: [...hosts, host], result: { kind: "added", host } };
}

export function recordDaemonId(hosts: readonly Host[], id: string, daemonId: string): { hosts: Host[]; merged: boolean } {
  const index = hosts.findIndex((host) => host.id === id);
  if (index < 0) return { hosts: hosts.slice(), merged: false };
  const twin = hosts.findIndex((host) => host.id !== id && host.daemonId === daemonId);
  if (twin < 0) {
    const next = hosts.slice();
    next[index] = { ...hosts[index]!, daemonId };
    return { hosts: next, merged: false };
  }
  const older = hosts[twin]!.addedAt <= hosts[index]!.addedAt ? twin : index;
  const newer = older === twin ? index : twin;
  const kept: Host = { ...hosts[older]!, baseUrl: hosts[newer]!.baseUrl, deviceToken: hosts[newer]!.deviceToken, daemonId };
  const next = hosts.filter((_, i) => i !== newer).map((host) => (host.id === kept.id ? kept : host));
  return { hosts: next, merged: true };
}

export function renameHost(hosts: readonly Host[], id: string, name: string): Host[] {
  const trimmed = name.trim();
  return hosts.map((host) => (host.id === id ? { ...host, name: trimmed || defaultHostName(host.baseUrl) } : host));
}

export function removeHost(hosts: readonly Host[], id: string): Host[] {
  return hosts.filter((host) => host.id !== id);
}
