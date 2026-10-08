import type { RuntimeMode } from "@telar/engine-client";
import { sessionModelSelection, type ModelChoice } from "@telar/client/providers";
import type { HostConnection } from "../../platform/connection";

export function setSessionModel(host: HostConnection, sessionId: string, instanceId: string, choice: ModelChoice) {
  return host.call(false, () => host.client.updateSession(sessionId, { model: sessionModelSelection(instanceId, choice) ?? null }));
}

export function setAccessMode(host: HostConnection, sessionId: string, runtimeMode: RuntimeMode) {
  return host.call(false, () => host.client.updateSession(sessionId, { runtimeMode }));
}
