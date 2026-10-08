import { useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, useHosts } from "../hosts";
import { DiffSurface } from "./DiffSurface";

export function DiffScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Diff">>();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  return host ? <DiffSurface host={host} sessionId={params.sessionId} /> : null;
}
