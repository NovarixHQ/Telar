import { expect, test } from "bun:test";
import { useTempStores } from "../../../test/temp-store";
import { sessionsCapability, storeReads, storeSessionsPort } from "./capability";

const { readyStore } = useTempStores();

test("a session reading a run withdraws the wake still waiting to announce it; a person's read does not", async () => {
  const { store } = readyStore();
  store.lifecycle.createSession({ id: "session_two", projectId: "project_one" });
  store.subscriptions.subscribe("session_one", { targetSessionId: "session_two", once: true });
  store.intake.submitTurn("session_two", { runId: "run_w", input: "work" });
  const token = store.claims.claimTurn("session_two", "worker_one")!.claim!.token;
  store.turnLifecycle.markRunning("session_two", "run_w", token);
  store.turnLifecycle.completeTurn("session_two", "run_w", token, { text: "Done." });
  const queuedWakes = () => store.queries.turns("session_one").filter((turn) => turn.state === "queued" && turn.wakeReason);
  expect(queuedWakes()).toHaveLength(1);

  await sessionsCapability(storeSessionsPort(store), undefined, storeReads(store)).turn!("session_two", "run_w");
  expect(queuedWakes()).toHaveLength(1);

  const reader = sessionsCapability(storeSessionsPort(store), { sessionId: "session_one", proof: () => ({ runId: "run_x", claimToken: "token" }) }, storeReads(store));
  expect((await reader.turn!("session_two", "run_w"))?.resultText).toBe("Done.");
  expect(queuedWakes()).toEqual([]);
});
