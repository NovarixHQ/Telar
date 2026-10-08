import { useMemo, useSyncExternalStore } from "react";
import { inboxStore } from "./inboxes";
import { railRows, type RailRow } from "./rail";

export function useRail(hostId: string): { rows: RailRow[]; loaded: boolean; failed?: string } {
  const hostSnapshots = useSyncExternalStore(inboxStore.subscribe, inboxStore.read);
  const snapshot = hostSnapshots.find((entry) => entry.hostId === hostId)?.snapshot;
  return useMemo(
    () => ({
      rows: railRows([{ hostId, answer: snapshot?.answer }], Date.now()),
      loaded: snapshot?.answer !== undefined,
      ...(snapshot?.failed ? { failed: snapshot.failed } : {}),
    }),
    [snapshot, hostId],
  );
}
