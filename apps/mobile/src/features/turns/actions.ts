import type { RequestDecision } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";
import type { Answer } from "./question";

/** Ends the live turn and settles what was queued behind it, like the cockpit's Stop. */
export function stopSession(host: HostConnection, sessionId: string) {
  return host.call(false, () => host.client.stopSession(sessionId));
}

/** A declined request may carry why, which the agent reads; an answered question carries its answers by field. */
export function answerRequest(host: HostConnection, sessionId: string, requestId: string, decision: RequestDecision, extra: { reason?: string; answers?: Record<string, Answer> } = {}) {
  const { reason, answers } = extra;
  return host.call(false, () => host.client.resolveRequest(sessionId, requestId, { decision, ...(reason ? { reason } : {}), ...(answers ? { answers } : {}) }));
}

/** A queued message heard by the running turn without stopping it. */
export function promoteTurn(host: HostConnection, sessionId: string, runId: string) {
  return host.call(false, () => host.client.promoteTurn(sessionId, runId));
}

export function withdrawTurn(host: HostConnection, sessionId: string, runId: string) {
  return host.call(false, () => host.client.stopTurn(sessionId, runId));
}
