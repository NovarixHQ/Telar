import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mountRootsFor, volumeSupportOn, type Project, type ProjectAvailability } from "@telar/engine-client";
import { FOLDER_REACH_TIMEOUT_MS, folderFs, reachFolder, type FolderReach } from "./folder-reach";

export type VolumeIdentity = NonNullable<Project["volume"]>;

export type { ProjectAvailability };

export type VolumeDeps = {
  platform?: NodeJS.Platform;
  mounts?: readonly string[];
  stat?: (target: string) => fs.Stats;
  statAsync?: (target: string) => Promise<fs.Stats>;
  readdir?: (target: string) => string[];
  /** May answer synchronously; the default asks `diskutil` without blocking. */
  volumeUuid?: (mount: string) => string | undefined | Promise<string | undefined>;
};

type Resolved = Required<VolumeDeps>;

export { mountRootsFor, volumeSupportOn } from "@telar/engine-client";

const noUuid = (): undefined => undefined;

async function diskutilUuid(mount: string): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)("diskutil", ["info", "-plist", mount], { timeout: 5_000 });
    return parseVolumeUuid(stdout);
  } catch {
    return undefined;
  }
}

function resolveDeps(deps: VolumeDeps): Resolved {
  const platform = deps.platform ?? process.platform;
  const stat = deps.stat;
  return {
    platform,
    mounts: deps.mounts ?? mountRootsFor(platform),
    stat: stat ?? ((target) => fs.statSync(target)),
    statAsync: deps.statAsync ?? (stat ? async (target) => stat(target) : (target) => fs.promises.stat(target)),
    readdir: deps.readdir ?? ((target) => fs.readdirSync(target)),
    volumeUuid: deps.volumeUuid ?? (platform === "darwin" ? diskutilUuid : noUuid),
  };
}

export const statAsyncOf = (deps: VolumeDeps): ((target: string) => Promise<fs.Stats>) => resolveDeps(deps).statAsync;

export function mountPointForRoot(root: string, deps: VolumeDeps = {}): string | undefined {
  const { mounts } = resolveDeps(deps);
  for (const mountRoot of mounts) {
    const prefix = mountRoot.endsWith(path.sep) ? mountRoot : `${mountRoot}${path.sep}`;
    if (!root.startsWith(prefix)) continue;
    const [name] = root.slice(prefix.length).split(path.sep);
    if (!name) continue;
    return path.join(mountRoot, name);
  }
  return undefined;
}

export function isMountPoint(mount: string, deps: VolumeDeps = {}): boolean {
  const { stat } = resolveDeps(deps);
  const parent = path.dirname(mount);
  if (parent === mount) return false;
  try {
    return stat(mount).dev !== stat(parent).dev;
  } catch {
    return false;
  }
}

export function parseVolumeUuid(plist: string): string | undefined {
  const match = /<key>VolumeUUID<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  const uuid = match?.[1]?.trim();
  return uuid ? uuid : undefined;
}

/** Every entry under the mount roots, which live on the boot disk, so listing never waits on a drive. */
export function listedMounts(deps: VolumeDeps = {}): string[] {
  const resolved = resolveDeps(deps);
  const found: string[] = [];
  for (const mountRoot of resolved.mounts) {
    try {
      for (const name of resolved.readdir(mountRoot)) found.push(path.join(mountRoot, name));
    } catch {
      continue;
    }
  }
  return found.sort();
}

type UuidEntry = { settled: boolean; uuid?: string; answer: Promise<string | undefined> };
type UuidCache = { listing: string; entries: Map<string, UuidEntry> };
const uuidCaches = new WeakMap<object, UuidCache>();

function deviceOf(target: string, resolved: Resolved): number | undefined {
  try {
    return resolved.stat(target).dev;
  } catch {
    return undefined;
  }
}

// Answers live until the mount set (path and device) changes, so `diskutil` runs once per plug, never per request.
function uuidCache(resolved: Resolved): UuidCache {
  const listing = listedMounts(resolved).map((mount) => `${mount}\0${deviceOf(mount, resolved)}`).join("\0");
  let cache = uuidCaches.get(resolved.volumeUuid);
  if (cache?.listing !== listing) {
    cache = { listing, entries: new Map() };
    uuidCaches.set(resolved.volumeUuid, cache);
  }
  return cache;
}

function uuidEntry(mount: string, resolved: Resolved, cache = uuidCache(resolved)): UuidEntry {
  const cached = cache.entries.get(mount);
  if (cached) return cached;
  const asked = isMountPoint(mount, resolved) ? resolved.volumeUuid(mount) : undefined;
  let entry: UuidEntry;
  if (asked instanceof Promise) {
    const pending: UuidEntry = { settled: false, answer: Promise.resolve(undefined) };
    pending.answer = asked.catch(() => undefined).then((uuid) => {
      pending.settled = true;
      if (uuid !== undefined) pending.uuid = uuid;
      return uuid;
    });
    entry = pending;
  } else {
    entry = { settled: true, ...(asked === undefined ? {} : { uuid: asked }), answer: Promise.resolve(asked) };
  }
  cache.entries.set(mount, entry);
  return entry;
}

export function forgetVolumeIds(deps: VolumeDeps = {}): void {
  uuidCaches.delete(resolveDeps(deps).volumeUuid);
}

function volumeMount(root: string, resolved: Resolved): string | undefined {
  if (volumeSupportOn(resolved.platform) === "unsupported") return undefined;
  return mountPointForRoot(root, resolved);
}

/** From the cache only; a lookup still running answers undefined and is left to finish. */
export function volumeForRoot(root: string, deps: VolumeDeps = {}): VolumeIdentity | undefined {
  const resolved = resolveDeps(deps);
  const mount = volumeMount(root, resolved);
  if (mount === undefined) return undefined;
  const { uuid } = uuidEntry(mount, resolved);
  return uuid === undefined ? undefined : { mount, uuid };
}

export async function volumeForRootAsync(root: string, deps: VolumeDeps = {}): Promise<VolumeIdentity | undefined> {
  const resolved = resolveDeps(deps);
  const mount = volumeMount(root, resolved);
  if (mount === undefined) return undefined;
  const uuid = await uuidEntry(mount, resolved).answer;
  return uuid === undefined ? undefined : { mount, uuid };
}

export async function probeAvailability(
  project: { root: string; volume?: VolumeIdentity },
  deps: VolumeDeps = {},
): Promise<ProjectAvailability> {
  const { statAsync } = resolveDeps(deps);
  const stat = (target: string) => statAsync(target).catch(() => undefined);
  const volume = project.volume;
  let rootDev: number | undefined;
  const folder = reachFolder(project.root, {
    fs: { ...folderFs, stat: async (target) => {
      const found = await statAsync(target);
      rootDev = found.dev;
      return found;
    } },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const mounted = volume
    ? Promise.race([
        Promise.all([stat(volume.mount), path.dirname(volume.mount) !== volume.mount ? stat(path.dirname(volume.mount)) : undefined]),
        new Promise<"hung">((resolve) => (timer = setTimeout(() => resolve("hung"), FOLDER_REACH_TIMEOUT_MS))),
      ]).finally(() => clearTimeout(timer))
    : undefined;
  const [reach, mountStats] = await Promise.all([folder, mounted]);
  if (mountStats === "hung") return "unresponsive";
  if (mountStats) {
    const [mount, parent] = mountStats;
    if (!mount || !parent || mount.dev === parent.dev) return "unmounted";
    if (reach.reach === "ok" && rootDev !== mount.dev) return "unmounted";
  }
  return availabilityOf(reach);
}

export function unreachableSentence(name: string, availability: "denied" | "unresponsive"): string {
  return availability === "denied"
    ? `macOS or a security tool is denying access to the folder for ${name}. Allow access and this will work again.`
    : `The drive holding ${name} isn't responding; it may be disconnected or blocked by security software.`;
}

function availabilityOf(folder: FolderReach): ProjectAvailability {
  switch (folder.reach) {
    case "ok":
      return "available";
    case "missing":
    case "not_folder":
      return "missing";
    case "denied":
      return "denied";
    case "unresponsive":
    case "failing":
      return "unresponsive";
  }
}

export function knownVolumeMount(uuid: string, deps: VolumeDeps = {}): string | undefined {
  const resolved = resolveDeps(deps);
  const cache = uuidCache(resolved);
  return listedMounts(resolved).find((mount) => uuidEntry(mount, resolved, cache).uuid === uuid);
}

export async function findVolumeMount(uuid: string, deps: VolumeDeps = {}): Promise<string | undefined> {
  const resolved = resolveDeps(deps);
  const cache = uuidCache(resolved);
  const mounts = listedMounts(resolved);
  const uuids = await Promise.all(mounts.map((mount) => uuidEntry(mount, resolved, cache).answer));
  return mounts.find((_, index) => uuids[index] === uuid);
}

export function parseSolidState(info: string): boolean | undefined {
  const match = /^\s*Solid State:\s*(Yes|No)\s*$/im.exec(info);
  return match ? match[1]!.toLowerCase() === "yes" : undefined;
}

const rotational = new Map<string, Promise<boolean | undefined>>();

/** Whether `target` sits on a spinning disk; undefined when the platform cannot tell in time. */
export function onRotationalDisk(target: string): Promise<boolean | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  const mount = mountPointForRoot(path.resolve(target)) ?? "/";
  let answer = rotational.get(mount);
  if (!answer) {
    answer = promisify(execFile)("diskutil", ["info", mount], { timeout: 5_000 }).then(
      ({ stdout }) => {
        const solid = parseSolidState(stdout);
        return solid === undefined ? undefined : !solid;
      },
      () => undefined,
    );
    rotational.set(mount, answer);
  }
  return answer;
}
