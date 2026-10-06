import type { SimulatorSummary } from "@telar/engine-client";

type Params = Readonly<Record<string, string>>;

export const SIMULATOR_SURFACE = "simulator";

export function openSimulators(params: Params | undefined): string[] {
  return (params?.open ?? "").split(",").filter(Boolean);
}

export function withSimulatorShown(params: Params | undefined, id: string): Record<string, string> {
  const open = openSimulators(params);
  return { open: (open.includes(id) ? open : [...open, id]).join(","), active: id };
}

export function withSimulatorDropped(params: Params | undefined, id: string): Record<string, string> {
  const active = params?.active === id ? "" : (params?.active ?? "");
  return { open: openSimulators(params).filter((entry) => entry !== id).join(","), active };
}

type SimulatorEvent = { id: number; at: number; type: string; simulator?: SimulatorSummary; simulatorId?: string };

export function agentSimulatorChanges(events: readonly SimulatorEvent[], since: number, seen: Set<number>): Array<{ shown: string } | { dropped: string }> {
  const changes: Array<{ shown: string } | { dropped: string }> = [];
  for (const event of events) {
    if (event.at < since || seen.has(event.id)) continue;
    if (event.type === "simulator.opened" && event.simulator) changes.push({ shown: event.simulator.id });
    else if (event.type === "simulator.closed" && event.simulatorId) changes.push({ dropped: event.simulatorId });
    else continue;
    seen.add(event.id);
  }
  return changes;
}
