import { useMemo, useSyncExternalStore } from "react";
import { Settings } from "react-native";
import type { EnvMode } from "@telar/engine-client";
import { hosts, useHosts } from "../hosts";
import { inboxStore } from "./inboxes";
import { projectActivity, projectTargets, type Target } from "./new-session";

const TARGET_KEY = "telar.newSession.target";
const MODE_KEY = "telar.newSession.envMode";

/** The last project and workspace a session was started in on this phone. */
export const newSessionMemory = {
  target: (): string | undefined => {
    const value: unknown = Settings.get(TARGET_KEY);
    return typeof value === "string" && value ? value : undefined;
  },
  envMode: (): EnvMode => (Settings.get(MODE_KEY) === "local" ? "local" : "worktree"),
  remember: (target: string, envMode: EnvMode) => Settings.set({ [TARGET_KEY]: target, [MODE_KEY]: envMode }),
};

/** Every paired computer's projects, how recently each was used, and the computers that did not answer. */
export function useTargets(): { targets: Target[]; activity: Map<string, number>; loading: boolean; unreachable: string[]; computers: number } {
  const snapshots = useSyncExternalStore(inboxStore.subscribe, inboxStore.read);
  const rows = useHosts(hosts);
  return useMemo(() => {
    const byHost = new Map(snapshots.map((entry) => [entry.hostId, entry.snapshot]));
    const computers = rows.map(({ connection }) => ({ hostId: connection.hostId, name: connection.name, answer: byHost.get(connection.hostId)?.answer }));
    return {
      targets: projectTargets(computers),
      activity: projectActivity(computers),
      loading: computers.every((computer) => !computer.answer && !byHost.get(computer.hostId)?.failed),
      unreachable: computers.filter((computer) => !computer.answer && byHost.get(computer.hostId)?.failed).map((computer) => computer.name),
      computers: computers.length,
    };
  }, [snapshots, rows]);
}
