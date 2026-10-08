import type { ProviderInstance, Session, Turn } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel";

const LIVE: ReadonlySet<Turn["state"]> = new Set(["claimed", "running", "steering", "ambiguous"]);

export function switchProvider(next: Session, to: ProviderInstance, turns: Turn[], history: readonly Turn[]): boolean {
  if (!to.enabled) throw new EngineStateError("invalid_request", "that provider is turned off");
  if (turns.some((turn) => LIVE.has(turn.state))) {
    throw new EngineStateError("conflict", "wait for the running turn to finish before switching provider");
  }
  const from = { driver: next.driver, instanceId: next.providerInstanceId, ...(next.model?.model ? { model: next.model.model } : {}) };
  let stamped = false;
  for (const turn of turns) {
    if (turn.providerInstanceId || turn.state === "queued") continue;
    turn.providerInstanceId = from.instanceId;
    stamped = true;
  }
  next.resumeCursors ??= next.resumeCursor ? { [from.instanceId]: next.resumeCursor } : {};
  next.providerSeen ??= { [from.instanceId]: Math.max(0, ...history.filter((turn) => turn.state !== "queued").map((turn) => turn.sequence)) };

  const origin = next.switchedFrom ?? from;
  if (origin.instanceId === to.id) delete next.switchedFrom;
  else next.switchedFrom = origin;
  next.driver = to.driver;
  next.providerInstanceId = to.id;
  const cursor = next.resumeCursors[to.id];
  if (cursor) next.resumeCursor = cursor;
  else delete next.resumeCursor;
  return stamped;
}
