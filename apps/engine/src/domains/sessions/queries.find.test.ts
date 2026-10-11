import { expect, test } from "bun:test";
import { EngineStore } from "../../state";
import { PROJECT_SEARCH_SQL } from "../../platform/db/tables";
import { useTempStores } from "../../../test/temp-store";

const { root } = useTempStores();

function converse(store: EngineStore, sessionId: string, runId: string, input: string, answer: string): void {
  store.intake.submitTurn(sessionId, { runId, input });
  const token = store.claims.claimTurn(sessionId, "worker_one")!.claim!.token;
  store.turnLifecycle.markRunning(sessionId, runId, token);
  store.turnLifecycle.completeTurn(sessionId, runId, token, { text: answer });
}

function busyEngine(others: number): EngineStore {
  const store = new EngineStore(root(), () => Date.now());
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  store.projectRegistry.register({ id: "project_busy", name: "Busy", root: "/private/var/tmp" });
  store.lifecycle.createSession({ id: "session_old", projectId: "project_one" });
  converse(store, "session_old", "run_1", "how did we wire the orchestrator wake", "the orchestrator wakes on a peer result");
  store.lifecycle.updateSession("session_old", { settledOverride: "settled" });
  store.lifecycle.createSession({ id: "session_live", projectId: "project_one" });
  converse(store, "session_live", "run_1", "orchestrator follow-up", "still going");
  const insert = store.kernel.executionStore.statement("INSERT INTO session_search(text, session_id, run_id) VALUES(?,?,?)");
  for (let index = 0; index < others; index += 1) {
    store.lifecycle.createSession({ id: `session_busy_${index}`, projectId: "project_busy" });
    insert.run(`orchestrator orchestrator orchestrator ${index}`, `session_busy_${index}`, "run_1");
  }
  return store;
}

test("a settled session is found by its content, within its project only", () => {
  const store = busyEngine(20);
  try {
    const settled = store.queries.findSessions({ q: "orchestrator wake", projectId: "project_one", settled: true, limit: 10 });
    expect(settled.sessions.map((row) => row.id)).toEqual(["session_old"]);
    expect(settled.sessions[0]!.why).toContain("orchestrator");

    const both = store.queries.findSessions({ q: "orchestrator", projectId: "project_one", limit: 10 });
    expect(both.sessions.map((row) => row.id).sort()).toEqual(["session_live", "session_old"]);
    expect(store.queries.findSessions({ q: "orchestrator wake", projectId: "project_busy", limit: 10 }).sessions).toHaveLength(0);
  } finally {
    store.kernel.executionStore.close();
  }
});

test("a project's hits are not crowded out by thousands of better-ranked hits elsewhere, and the query stays bounded", () => {
  const store = busyEngine(2_000);
  try {
    const started = Bun.nanoseconds();
    const found = store.queries.findSessions({ q: "orchestrator", projectId: "project_one", settled: true, limit: 10 });
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;
    expect(found.sessions.map((row) => row.id)).toEqual(["session_old"]);
    expect(elapsedMs).toBeLessThan(100);

    if (store.kernel.executionStore.searchIndex !== "fts5") return;
    const plan = store.kernel.executionStore.db.prepare(`EXPLAIN QUERY PLAN ${PROJECT_SEARCH_SQL}`).all('"orchestrator"', "project_one", 10) as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail).join("\n");
    expect(details).toMatch(/VIRTUAL TABLE INDEX/);
    expect(details).toMatch(/SEARCH sessions USING INDEX sqlite_autoindex_sessions_1/);
    expect(details).not.toMatch(/SCAN sessions/);
  } finally {
    store.kernel.executionStore.close();
  }
});
