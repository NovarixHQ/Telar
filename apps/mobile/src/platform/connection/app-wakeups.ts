import { AppState } from "react-native";
import type { HostRegistry } from "./hosts";
import { foregroundWakeup } from "./wakeups";

export function wakeOnForeground(registry: HostRegistry): () => void {
  let backgroundSince: number | undefined;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") backgroundSince = Date.now();
    if (state !== "active" || backgroundSince === undefined) return;
    registry.wakeAll(foregroundWakeup(Date.now() - backgroundSince));
    backgroundSince = undefined;
  });
  return () => subscription.remove();
}
