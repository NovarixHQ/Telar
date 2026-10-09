import type { Turn } from "@telar/engine-client";
import { assertId, EngineStateError, type Kernel } from "../../platform/kernel";
import type { SessionQueue, SessionRecords } from "../sessions";
import { MAX_TEXT_LENGTH } from "./intake";

type QueuedDeps = {
  records: SessionRecords;
  readQueue: (sessionId: string, runIds?: readonly string[]) => SessionQueue;
  writeQueue: (sessionId: string, queue: SessionQueue) => void;
};

export class QueuedTurns {
  constructor(
    private readonly kernel: Kernel,
    private readonly deps: QueuedDeps,
  ) {}

  editQueuedTurn(sessionId: string, runId: string, input: unknown): Turn {
    return this.kernel.command("editQueuedTurn", () => {
      if (typeof input !== "string" || input.trim() === "" || input.length > MAX_TEXT_LENGTH) {
        throw new EngineStateError("invalid_request", "turn text must be non-empty and within the allowed size");
      }
      const queue = this.deps.readQueue(sessionId, [runId]);
      const turn = waiting(queue, runId);
      turn.input = input;
      return this.saved(sessionId, queue, [turn])[0]!;
    });
  }

  moveQueuedTurn(sessionId: string, runId: string, beforeRunId: string | null): Turn {
    return this.kernel.command("moveQueuedTurn", () => {
      const queue = this.deps.readQueue(sessionId, [runId, ...(beforeRunId ? [beforeRunId] : [])]);
      const moved = waiting(queue, runId);
      const before = beforeRunId === null ? undefined : waiting(queue, beforeRunId);
      const line = queue.turns.filter((turn) => turn.state === "queued").sort((a, b) => a.sequence - b.sequence);
      const slots = line.map((turn) => turn.sequence);
      const order = line.filter((turn) => turn !== moved);
      order.splice(before ? order.indexOf(before) : order.length, 0, moved);
      const changed = order.filter((turn, index) => turn.sequence !== slots[index]);
      order.forEach((turn, index) => (turn.sequence = slots[index]!));
      queue.turns.sort((a, b) => a.sequence - b.sequence);
      if (changed.length === 0) return structuredClone(moved);
      this.saved(sessionId, queue, changed);
      return structuredClone(moved);
    });
  }

  private saved(sessionId: string, queue: SessionQueue, changed: Turn[]): Turn[] {
    const at = this.kernel.now();
    for (const turn of changed) turn.updatedAt = at;
    this.deps.writeQueue(sessionId, queue);
    this.deps.records.touch(sessionId, at);
    for (const turn of changed) this.kernel.appendEvent(sessionId, { type: "turn.accepted", turn: structuredClone(turn), replayed: true }, turn.runId);
    return changed.map((turn) => structuredClone(turn));
  }
}

function waiting(queue: SessionQueue, runId: string): Turn {
  assertId(runId, "run id");
  const turn = queue.turns.find((candidate) => candidate.runId === runId);
  if (!turn) throw new EngineStateError("not_found", "turn does not exist");
  if (turn.state !== "queued") throw new EngineStateError("conflict", "only a queued message can be changed");
  return turn;
}
