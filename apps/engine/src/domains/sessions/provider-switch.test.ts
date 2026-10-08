import { expect, test } from "bun:test";
import type { EngineStore } from "../../state";
import { useTempStores } from "../../../test/temp-store";

const { readyStore } = useTempStores();

function answer(store: EngineStore, runId: string, input: string, text: string, cursor: string) {
  store.intake.submitTurn("session_one", { runId, input });
  const claim = store.claims.claimNextTurn("worker_one")!;
  const token = claim.turn.claim!.token;
  store.turnLifecycle.markRunning("session_one", runId, token);
  store.turnLifecycle.completeTurn("session_one", runId, token, { text, providerSessionId: cursor });
  return claim;
}

const codex = { instanceId: "codex", model: "gpt-5.4" };
const claude = { instanceId: "claude", model: "claude-opus-5-5" };

test("switching provider hands the new one only the turns it has not seen, once", () => {
  const { store } = readyStore();
  answer(store, "run_one", "keep the panel API unchanged", "Done, the API is as it was.", "claude-thread");
  answer(store, "run_two", "now add a screenshot surface", "Added it.", "claude-thread");

  const switched = store.lifecycle.updateSession("session_one", { model: codex });
  expect(switched).toMatchObject({ driver: "codex", providerInstanceId: "codex", switchedFrom: { driver: "claude", instanceId: "claude" } });
  expect(switched.resumeCursor).toBeUndefined();
  expect(switched.resumeCursors).toEqual({ claude: "claude-thread" });

  const first = answer(store, "run_three", "and make it faster", "Faster now.", "codex-thread");
  expect(first.driver).toBe("codex");
  expect(first.resumeCursor).toBeUndefined();
  expect(first.carriedContext).toContain("User (turn 1):\nkeep the panel API unchanged");
  expect(first.carriedContext).toContain("Assistant (turn 2):\nAdded it.");
  expect(first.carriedContext).toContain('sessions_read(sessionId: "session_one"');
  expect(first.carriedContext).not.toContain("make it faster");

  const row = store.queries.items("session_one").find((item) => item.detail.type === "provider_switch");
  expect(row).toMatchObject({ runId: "run_three", title: "Switched from claude to codex · gpt-5.4", detail: { carriedTurns: 2 } });

  const next = answer(store, "run_four", "thanks", "Welcome.", "codex-thread");
  expect(next.carriedContext).toBeUndefined();
  expect(next.resumeCursor).toBe("codex-thread");
  expect(store.queries.items("session_one").filter((item) => item.detail.type === "provider_switch")).toHaveLength(1);
});

test("switching back resumes the first provider's own thread with only what it missed", () => {
  const { store } = readyStore();
  answer(store, "run_one", "first question", "first answer", "claude-thread");
  store.lifecycle.updateSession("session_one", { model: codex });
  answer(store, "run_two", "second question", "second answer", "codex-thread");

  const back = store.lifecycle.updateSession("session_one", { model: claude });
  expect(back).toMatchObject({ driver: "claude", resumeCursor: "claude-thread", resumeCursors: { claude: "claude-thread", codex: "codex-thread" } });
  const claim = answer(store, "run_three", "third question", "third answer", "claude-thread");
  expect(claim.resumeCursor).toBe("claude-thread");
  expect(claim.carriedContext).toContain("second answer");
  expect(claim.carriedContext).not.toContain("first question");
});

test("switching and switching back before sending draws no row and carries nothing", () => {
  const { store } = readyStore();
  answer(store, "run_one", "question", "answer", "claude-thread");
  store.lifecycle.updateSession("session_one", { model: codex });
  expect(store.lifecycle.updateSession("session_one", { model: claude }).switchedFrom).toBeUndefined();
  const claim = answer(store, "run_two", "again", "ok", "claude-thread");
  expect(claim.carriedContext).toBeUndefined();
  expect(store.queries.items("session_one").some((item) => item.detail.type === "provider_switch")).toBe(false);
});

test("the carried range stays on the turn, so a re-claim hands the same context again", () => {
  const { store } = readyStore();
  answer(store, "run_one", "question", "answer", "claude-thread");
  store.lifecycle.updateSession("session_one", { model: codex });
  store.intake.submitTurn("session_one", { runId: "run_two", input: "go on" });
  const first = store.claims.claimNextTurn("worker_one")!;
  expect(first.carriedContext).toContain("question");
  expect(store.queries.turns("session_one").find((turn) => turn.runId === "run_two")?.carried).toEqual({ from: 1, through: 1 });
});

test("a provider cannot be switched while a turn is running", () => {
  const { store } = readyStore();
  store.intake.submitTurn("session_one", { runId: "run_one", input: "long job" });
  store.claims.claimNextTurn("worker_one");
  expect(() => store.lifecycle.updateSession("session_one", { model: codex })).toThrow(/running turn to finish/);
});
