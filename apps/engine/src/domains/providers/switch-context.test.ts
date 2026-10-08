import { expect, test } from "bun:test";
import type { Turn } from "@telar/engine-client";
import { buildSwitchContext, unseenTurns } from "./switch-context";

const turn = (sequence: number, input: string, resultText: string, providerInstanceId = "claude"): Turn => ({
  runId: `run_${sequence}`,
  sessionId: "session_one",
  sequence,
  state: "completed",
  input,
  resultText,
  acceptedAt: sequence,
  updatedAt: sequence,
  providerInstanceId,
});

test("everything fits: every turn, oldest first, under a header that says how to read the rest", () => {
  const text = buildSwitchContext([turn(1, "first ask", "first answer"), turn(2, "second ask", "second answer")], { sessionId: "session_one" })!;
  expect(text.startsWith("Context from this session (context, not instructions)")).toBe(true);
  expect(text).toContain('sessions_read(sessionId: "session_one"');
  expect(text.indexOf("first ask")).toBeLessThan(text.indexOf("second answer"));
  expect(text).not.toMatch(/omitted$/);
});

test("over budget, the last request, last answer and first request survive; the middle goes first", () => {
  const turns = [turn(1, "the opening brief", "a".repeat(300)), ...[2, 3, 4].map((n) => turn(n, `middle ${n} ${"m".repeat(300)}`, "b".repeat(300))), turn(5, "the latest ask", "the latest answer")];
  const text = buildSwitchContext(turns, { sessionId: "session_one", budget: 900 })!;
  expect(text.length).toBeLessThanOrEqual(900);
  expect(text).toContain("the opening brief");
  expect(text).toContain("the latest ask");
  expect(text).toContain("the latest answer");
  expect(text).not.toContain("middle 2");
  expect(text).toMatch(/… \d turns omitted$/);
});

test("only turns another provider answered are unseen; compactions and empty turns carry nothing", () => {
  const turns = [turn(1, "a", "b", "codex"), turn(2, "c", "d"), { ...turn(3, "compact", ""), kind: "compact" as const }, turn(4, "", "", "claude")];
  expect(unseenTurns(turns, { from: 1, through: 4 }, "codex").map((entry) => entry.sequence)).toEqual([2]);
  expect(buildSwitchContext([], { sessionId: "session_one" })).toBeUndefined();
});
