import type { RequestDecision } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

/** Ends the live turn and settles what was queued behind it, like the cockpit's Stop. */
export function stopSession(host: HostConnection, sessionId: string) {
  return host.call(false, () => host.client.stopSession(sessionId));
}

export function answerRequest(host: HostConnection, sessionId: string, requestId: string, decision: RequestDecision) {
  return host.call(false, () => host.client.resolveRequest(sessionId, requestId, { decision }));
}
