import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineStore } from "../../state";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function running(store: EngineStore, sessionId: string, runId: string) {
  store.intake.submitTurn(sessionId, { runId, input: "work" });
  const claimToken = store.claims.claimTurn(sessionId, `worker_${sessionId}`)!.claim!.token;
  store.turnLifecycle.markRunning(sessionId, runId, claimToken);
  return { sessionId, runId, claimToken };
}

/** `session_a` created `session_child` and tasked it; `session_b` is another orchestrator. */
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-handoff-"));
  homes.push(home);
  fs.writeFileSync(path.join(home, "claude-default-model.json"), JSON.stringify({ model: "claude-opus-5[1m]", at: 1 }));
  const store = new EngineStore(home, Date.now);
  store.projectRegistry.register({ id: "project_one", name: "One", root: "/tmp" });
  fs.mkdirSync(path.join(home, "two"));
  store.projectRegistry.register({ id: "project_two", name: "Two", root: path.join(home, "two") });
  store.lifecycle.createSession({ id: "session_a", projectId: "project_one" });
  store.lifecycle.createSession({ id: "session_b", projectId: "project_two" });
  store.lifecycle.createSession({ id: "session_child", projectId: "project_one", startedFrom: { sessionId: "session_a" } });
  const a = running(store, "session_a", "run_a");
  store.intake.submitAgentTurn("session_child", { runId: "run_task", input: "build it", intent: "task" }, a);
  store.turnLifecycle.completeTurn("session_a", "run_a", a.claimToken, { text: "tasked" });
  store.subscriptions.subscribeCohort("session_a", { sessionIds: ["session_child"] });
  const claimToken = store.claims.claimTurn("session_child", "worker_child")!.claim!.token;
  store.turnLifecycle.markRunning("session_child", "run_task", claimToken);
  return { store, child: { sessionId: "session_child", runId: "run_task", claimToken } };
}

const handedOff = (store: EngineStore, sessionId: string) => store.queries.readEvents(sessionId, 0).filter((event) => event.type === "session.handed_off");

test("detaching makes the session stand alone and its old parent stops waiting on it", () => {
  const { store } = setup();
  expect(store.records.get("session_a").activity).toBe("waiting");

  const session = store.handoff.handOff("session_child", {});

  expect(session.startedFrom).toBeUndefined();
  expect(store.handoff.parentOf("session_child")).toBeUndefined();
  expect(store.records.get("session_a").activity).toBe("idle");
  expect(store.subscriptions.cohortsFor("session_a")).toEqual([]);
  expect(handedOff(store, "session_a")).toMatchObject([{ subject: "session_child", from: "session_a" }]);
  expect(handedOff(store, "session_child")).toHaveLength(1);
});

test("reassigning moves the waiting and the results to the new parent", () => {
  const { store, child } = setup();

  store.handoff.handOff("session_child", { to: "session_b" });

  expect(store.handoff.parentOf("session_child")).toBe("session_b");
  expect(store.records.get("session_a").activity).toBe("idle");
  expect(store.records.get("session_b")).toMatchObject({ activity: "waiting", activityDetail: { kind: "session", sessionId: "session_child", sessions: 1 } });
  expect(() => store.intake.submitAgentTurn("session_a", { runId: "run_late", input: "done", intent: "result" }, child)).toThrow("never assigned you work");
  expect(store.intake.submitAgentTurn("session_b", { runId: "run_result", input: "done", intent: "result" }, child).turn.agentDelivery).toBe("wake");

  store.turnLifecycle.completeTurn("session_child", "run_task", child.claimToken, { text: "built" });
  expect(store.queries.turns("session_a").filter((turn) => turn.origin === "session")).toEqual([]);
  expect(handedOff(store, "session_b")).toMatchObject([{ subject: "session_child", from: "session_a", to: "session_b" }]);
});

test("a move that would make a loop is refused, and so is a session moving itself", () => {
  const { store } = setup();
  store.lifecycle.createSession({ id: "session_grandchild", projectId: "project_one", startedFrom: { sessionId: "session_child" } });

  expect(() => store.handoff.handOff("session_child", { to: "session_grandchild" })).toThrow("loop");
  expect(() => store.handoff.handOff("session_a", { to: "session_grandchild" })).toThrow("loop");
  expect(() => store.handoff.handOff("session_child", { to: "session_child" })).toThrow("itself");
  expect(store.handoff.parentOf("session_child")).toBe("session_a");
});

test("only the current parent may hand a session off on its own", () => {
  const { store } = setup();

  expect(() => store.handoff.handOff("session_child", { to: "session_b", by: "session_b" })).toThrow("only the session this one reports to");
  expect(store.handoff.handOff("session_child", { to: "session_b", by: "session_a" }).startedFrom?.sessionId).toBe("session_b");
});
