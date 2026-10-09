import { expect, test } from "bun:test";
import type { EngineStore } from "../../state";
import { useTempStores } from "../../../test/temp-store";
import { forkInput } from "./fork";

const { readyStore } = useTempStores();

function answer(store: EngineStore, sessionId: string, runId: string, input: string, text: string, cursor: string) {
  store.intake.submitTurn(sessionId, { runId, input });
  const claim = store.claims.claimNextTurn("worker_one")!;
  const token = claim.turn.claim!.token;
  store.turnLifecycle.markRunning(sessionId, runId, token);
  store.turnLifecycle.completeTurn(sessionId, runId, token, { text, providerSessionId: cursor });
  return claim;
}

test("a fork carries the conversation through the chosen reply and nothing after it", async () => {
  const { store } = readyStore();
  store.lifecycle.updateSession("session_one", { title: "Panel work" });
  answer(store, "session_one", "run_one", "keep the panel API unchanged", "Done, the API is as it was.", "thread-one");
  answer(store, "session_one", "run_two", "now add a screenshot surface", "Added it.", "thread-one");
  answer(store, "session_one", "run_three", "and make it faster", "Faster now.", "thread-one");

  const fork = await store.requestPath.createSession(forkInput(store.records, "session_one", "run_two"));
  expect(fork).toMatchObject({ projectId: "project_one", title: "Fork of Panel work", startedFrom: { sessionId: "session_one" } });
  expect(fork.providerInstanceId).toBe(store.records.get("session_one").providerInstanceId);

  const first = answer(store, fork.id, "run_fork_one", "try it another way", "Tried.", "thread-fork");
  expect(first.resumeCursor).toBeUndefined();
  expect(first.carriedContext).toContain("User (turn 1):\nkeep the panel API unchanged");
  expect(first.carriedContext).toContain("Assistant (turn 2):\nAdded it.");
  expect(first.carriedContext).toContain('sessions_read(sessionId: "session_one"');
  expect(first.carriedContext).not.toContain("make it faster");
  expect(first.carriedContext).not.toContain("Faster now.");

  const next = answer(store, fork.id, "run_fork_two", "thanks", "Welcome.", "thread-fork");
  expect(next.carriedContext).toBeUndefined();
  expect(store.queries.turns("session_one").map((turn) => turn.runId)).toEqual(["run_one", "run_two", "run_three"]);
});

test("only a finished reply in the session can be forked", () => {
  const { store } = readyStore();
  store.intake.submitTurn("session_one", { runId: "run_one", input: "long job" });
  expect(() => forkInput(store.records, "session_one", "run_one")).toThrow(/finished reply/);
  expect(() => forkInput(store.records, "session_one", "run_missing")).toThrow(/not in this session/);
});
