import { useMemo, useSyncExternalStore } from "react";
import { hosts, useHosts } from "../hosts";
import { inboxStore } from "./inboxes";
import { flatRail, hostFailures, railSections, type HostFailure, type RailRow, type RailSections } from "./rail";

/** One host's active rows, for pickers that stay on one computer. */
export function useRail(hostId: string): { rows: RailRow[] } {
  const snapshots = useSyncExternalStore(inboxStore.subscribe, inboxStore.read);
  const answer = snapshots.find((entry) => entry.hostId === hostId)?.snapshot.answer;
  return useMemo(() => ({ rows: railSections([{ hostId, answer }], Date.now()).active }), [answer, hostId]);
}

export type MergedRail = {
  sections: RailSections;
  pinned: RailRow[];
  rows: RailRow[];
  computers: { hostId: string; name: string }[];
  filter: string | undefined;
  failures: HostFailure[];
  stale: ReadonlySet<string>;
  loaded: boolean;
  hasProjects: boolean;
};

/** Every paired computer's sessions as one rail, optionally kept to one computer. */
export function useMergedRail(chosen: string | undefined): MergedRail {
  const snapshots = useSyncExternalStore(inboxStore.subscribe, inboxStore.read);
  const hostRows = useHosts(hosts);
  return useMemo(() => {
    const byHost = new Map(snapshots.map((entry) => [entry.hostId, entry.snapshot]));
    const computers = hostRows.map(({ connection }) => ({ hostId: connection.hostId, name: connection.name }));
    const filter = computers.some((computer) => computer.hostId === chosen) ? chosen : undefined;
    const inScope = computers.filter((computer) => filter === undefined || computer.hostId === filter);
    const sections = railSections(
      inScope.map(({ hostId }) => ({ hostId, answer: byHost.get(hostId)?.answer })),
      Date.now(),
    );
    const pinnedOrders = new Map(inScope.map(({ hostId }) => [hostId, byHost.get(hostId)?.answer?.layout?.pinnedOrder ?? []]));
    const failures = hostFailures(
      hostRows
        .filter(({ connection }) => filter === undefined || connection.hostId === filter)
        .map(({ connection, state }) => {
          const snapshot = byHost.get(connection.hostId);
          return { hostId: connection.hostId, name: connection.name, state: state.kind, answered: snapshot?.answer !== undefined, ...(snapshot?.failed ? { failed: snapshot.failed } : {}) };
        }),
    );
    return {
      sections,
      ...flatRail(sections.active, pinnedOrders),
      computers,
      filter,
      failures,
      stale: new Set(failures.filter((failure) => failure.stale).map((failure) => failure.hostId)),
      loaded: inScope.some(({ hostId }) => byHost.get(hostId)?.answer !== undefined),
      hasProjects: inScope.some(({ hostId }) => (byHost.get(hostId)?.answer?.projects.length ?? 0) > 0),
    };
  }, [snapshots, hostRows, chosen]);
}
