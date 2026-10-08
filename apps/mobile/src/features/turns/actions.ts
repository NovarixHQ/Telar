import type { RequestDecision } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

/** Ends the live turn and settles what was queued behind it, like the cockpit's Stop. */
export function stopSession(host: HostConnection, sessionId: string) {
  return host.call(false, () => host.client.stopSession(sessionId));
}

/** A declined request may carry why, which the agent reads. */
export function answerRequest(host: HostConnection, sessionId: string, requestId: string, decision: RequestDecision, reason?: string) {
  return host.call(false, () => host.client.resolveRequest(sessionId, requestId, { decision, ...(reason ? { reason } : {}) }));
}

/** A queued message heard by the running turn without stopping it. */
export function promoteTurn(host: HostConnection, sessionId: string, runId: string) {
  return host.call(false, () => host.client.promoteTurn(sessionId, runId));
}

export function withdrawTurn(host: HostConnection, sessionId: string, runId: string) {
  return host.call(false, () => host.client.stopTurn(sessionId, runId));
}
