import { EngineStateError } from "../../platform/kernel";
import type { CreateSessionInput } from "./lifecycle-store";
import type { SessionRecords } from "./records";

export function forkInput(records: Pick<SessionRecords, "require" | "history">, sessionId: string, runId: string): CreateSessionInput {
  const source = records.require(sessionId);
  const turn = records.history(sessionId).find((each) => each.runId === runId);
  if (!turn) throw new EngineStateError("not_found", "that turn is not in this session");
  if (turn.state !== "completed") throw new EngineStateError("conflict", "only a finished reply can be forked");
  const { model, effort } = source.model ?? {};
  return {
    ...(source.projectId ? { projectId: source.projectId } : {}),
    providerInstanceId: source.providerInstanceId,
    ...(model || effort ? { model: { ...(model ? { model } : {}), ...(effort ? { effort } : {}) } } : {}),
    envMode: source.envMode,
    detached: source.detached,
    title: `Fork of ${source.title}`,
    startedFrom: { sessionId },
    forkedFrom: { sessionId, runId, sequence: turn.sequence },
  };
}
