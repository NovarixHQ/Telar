import type { EngineStore } from "../src/state";

/** `session_one` orchestrating `session_a` and `session_b`, driven turn by turn the way a worker would. */
export function orchestration(store: EngineStore) {
  const host = "session_one";
  for (const id of ["session_a", "session_b"]) store.lifecycle.createSession({ id, projectId: "project_one", title: id });
  let submitted = 0;
  const turn = (sessionId: string) => {
    if (!store.queries.turns(sessionId).some((each) => each.state === "queued")) {
      store.intake.submitTurn(sessionId, { runId: `run_${sessionId}_${++submitted}`, input: "go on" });
    }
    const claimed = store.claims.claimTurn(sessionId, `worker_${sessionId}`)!;
    const claimToken = claimed.claim!.token;
    store.turnLifecycle.markRunning(sessionId, claimed.runId, claimToken);
    const proof = { sessionId, runId: claimed.runId, claimToken };
    return {
      runId: claimed.runId,
      task: (to: string, input: string) => store.intake.submitAgentTurn(to, { runId: `run_task_${++submitted}`, input, intent: "task" }, proof),
      result: (input: string, to = host) => store.intake.submitAgentTurn(to, { runId: `run_result_${++submitted}`, input, intent: "result" }, proof),
      end: () => store.turnLifecycle.completeTurn(sessionId, claimed.runId, claimToken, { text: "finished" }),
      stop: () => store.turnLifecycle.stopTurn(sessionId, claimed.runId),
    };
  };
  const cohortWakes = () => store.queries.turns(host).filter((each) => each.notification?.cohortId);
  const cohorts = () => store.subscriptions.cohortsFor(host).map((cohort) => cohort.members.map((member) => member.sessionId));
  return { host, turn, cohortWakes, cohorts };
}
