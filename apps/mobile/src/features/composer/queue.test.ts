import { expect, test } from "bun:test";
import type { JournalTurn } from "@telar/client/journal";
import { hasRunningTurn, queuedTurns, queueSummary } from "./queue";

const turn = (runId: string, state: JournalTurn["state"]) => ({ runId, prompt: runId, state }) as JournalTurn;

test("queued and steering turns wait behind the running one", () => {
  const turns = [turn("done", "completed"), turn("live", "running"), turn("next", "queued"), turn("after", "queued")];
  expect(queuedTurns(turns).map((row) => row.runId)).toEqual(["next", "after"]);
  expect(hasRunningTurn(turns)).toBe(true);
  expect(hasRunningTurn([turn("next", "queued")])).toBe(false);
});

test("the line counts what will send, or says a message is going into the turn", () => {
  expect(queueSummary([turn("a", "queued")])).toBe("1 queued message will send automatically.");
  expect(queueSummary([turn("a", "queued"), turn("b", "queued")])).toBe("2 queued messages will send automatically.");
  expect(queueSummary([turn("a", "steering"), turn("b", "queued")])).toBe("Sending into the running turn…");
});
