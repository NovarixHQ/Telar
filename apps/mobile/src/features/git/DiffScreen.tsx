import { Host } from "@expo/ui/swift-ui";
import { useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, useHosts } from "../hosts";
import { DiffSurface } from "./DiffSurface";

export function DiffScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Diff">>();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  return <Host style={{ flex: 1 }}>{host ? <DiffSurface host={host} sessionId={params.sessionId} /> : null}</Host>;
}
