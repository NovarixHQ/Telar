import type { SimulatorSummary } from "@telar/engine-client";
import type { ProcessRunner } from "../../platform/process/runner";

type SimctlDevice = { udid?: unknown; name?: unknown; state?: unknown; isAvailable?: unknown };
type SimctlPair = { watch?: { udid?: unknown }; phone?: { udid?: unknown } };
type SimctlList = { devices?: Record<string, SimctlDevice[]>; pairs?: Record<string, SimctlPair> };

const WATCH_RUNTIME = /SimRuntime\.watchOS-(\d+(?:-\d+)*)$/;

export function parseWatches(json: string): SimulatorSummary[] {
  let list: SimctlList;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  const phoneOf = new Map<string, string>();
  for (const pair of Object.values(list.pairs ?? {})) {
    if (typeof pair.watch?.udid === "string" && typeof pair.phone?.udid === "string") phoneOf.set(pair.watch.udid, pair.phone.udid);
  }
  return Object.entries(list.devices ?? {}).flatMap(([runtime, devices]) => {
    const version = runtime.match(WATCH_RUNTIME)?.[1];
    if (!version || !Array.isArray(devices)) return [];
    return devices.flatMap((device) => {
      const pairedWith = typeof device.udid === "string" ? phoneOf.get(device.udid) : undefined;
      if (!pairedWith || device.isAvailable !== true || typeof device.name !== "string") return [];
      const watch: SimulatorSummary = { id: device.udid as string, platform: "ios", name: device.name, version: `watchOS ${version.replaceAll("-", ".")}`, booted: device.state === "Booted", physical: false, pairedWith };
      return [watch];
    });
  });
}

/** The hub lists only iOS runtimes, so paired watches come from simctl and sit right after their iPhone. */
export async function listPairedWatches(run: ProcessRunner["run"]): Promise<SimulatorSummary[]> {
  const { code, stdout } = await run("xcrun", ["simctl", "list", "--json", "devices", "pairs"], { timeoutMs: 15_000 }).catch(() => ({ code: 1, stdout: "" }));
  return code === 0 ? parseWatches(stdout) : [];
}

export function withWatches<T extends SimulatorSummary>(devices: T[], all: readonly T[]): T[] {
  const watches = all.filter((watch) => !devices.some((device) => device.id === watch.id));
  const placed = new Set<string>();
  const listed = devices.flatMap((device) => {
    const mine = watches.filter((watch) => watch.pairedWith === device.id);
    for (const watch of mine) placed.add(watch.id);
    return [device, ...mine];
  });
  return [...listed, ...watches.filter((watch) => !placed.has(watch.id))];
}
