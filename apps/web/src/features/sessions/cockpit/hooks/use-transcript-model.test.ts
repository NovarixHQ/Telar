import { expect, test } from "bun:test";
import type { Turn } from "@telar/engine-client";
import { personQueue } from "./use-transcript-model";

const turn = (runId: string, sequence: number, state: Turn["state"], extra: Partial<Turn> = {}): Turn =>
  ({ runId, sessionId: "session_one", sequence, input: runId, state, acceptedAt: 1, updatedAt: 1, ...extra }) as Turn;

test("lists a person's waiting messages by sequence, only while a turn is live", () => {
  const waiting = [turn("b", 3, "queued"), turn("a", 2, "queued"), turn("peer", 4, "queued", { origin: "session" }), turn("held", 5, "queued", { held: { at: 1, reason: "engine_restart" } })];
  expect(personQueue([turn("live", 1, "running"), ...waiting]).map((row) => row.runId)).toEqual(["a", "b"]);
  expect(personQueue([turn("done", 1, "completed"), ...waiting])).toEqual([]);
});
