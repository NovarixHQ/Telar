import { expect, test } from "bun:test";
import type { JournalTurn } from "@telar/client/journal";
import { pendingStillShown, withPendingTurn } from "./pending-turn";

const pending = { runId: "run_1", prompt: "map the exoplanets", acceptedAt: 5 };
const turn = (runId: string): JournalTurn => ({ runId, prompt: "", state: "running", items: [], tasks: [], resultText: "" });

test("the sent message is the person's queued turn until the journal has one with its run id", () => {
  expect(withPendingTurn([], pending)).toEqual([
    { runId: "run_1", prompt: "map the exoplanets", acceptedAt: 5, origin: "user", state: "queued", items: [], tasks: [], resultText: "" },
  ]);
  const landed = [turn("run_1")];
  expect(withPendingTurn(landed, pending)).toBe(landed);
  expect(withPendingTurn(landed, undefined)).toBe(landed);
});

test("it is dropped once its turn lands, or when the cockpit shows another session", () => {
  expect(pendingStillShown(pending, undefined, [])).toBe(true);
  const created = { ...pending, sessionId: "session_a" };
  expect(pendingStillShown(created, "session_a", [])).toBe(true);
  expect(pendingStillShown(created, "session_a", [turn("run_1")])).toBe(false);
  expect(pendingStillShown(created, "session_b", [])).toBe(false);
});
