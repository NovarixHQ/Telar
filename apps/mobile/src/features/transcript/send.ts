import type { HostConnection } from "../../platform/connection";

function newRunId(random: () => number = Math.random): string {
  let hex = "";
  while (hex.length < 32) hex += Math.floor(random() * 16).toString(16);
  return `run_${hex}`;
}

/** The run id is minted before the request, so a retry of the same message is the same turn, never a second one. */
export function sendMessage(host: HostConnection, sessionId: string, text: string, runId: string = newRunId()) {
  return host.call(false, () => host.client.submitTurn(sessionId, { runId, input: text }));
}
