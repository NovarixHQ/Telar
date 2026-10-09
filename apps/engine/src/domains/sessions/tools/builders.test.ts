import { afterEach, expect, test } from "bun:test";
import type { EngineStore } from "../../../state";
import { call, cleanUp, engine, orchestrator } from "./test-helpers";

afterEach(cleanUp);

async function fleet() {
  const { store, projectId } = engine();
  const { parent, tools } = orchestrator(store, projectId);
  const builder = async (title: string) => {
    const id = store.lifecycle.createSession({ projectId, title }).id;
    await call(tools, "sessions_send", { sessionId: id, input: `Do ${title}.`, intent: "task" });
    const claimed = store.claims.claimTurn(id, `worker_${title}`)!;
    store.turnLifecycle.markRunning(id, claimed.runId, claimed.claim!.token);
    const proof = { sessionId: id, runId: claimed.runId, claimToken: claimed.claim!.token };
    return {
      id,
      say: (intent: "result" | "blocker", input: string) => store.intake.submitAgentTurn(parent.id, { runId: `run_${title}_${intent}`, input, intent }, proof).turn,
    };
  };
  const parentToken = store.queries.turns(parent.id).find((turn) => turn.runId === "run_parent")!.claim!.token;
  const endParentTurn = () => store.turnLifecycle.completeTurn(parent.id, "run_parent", parentToken, { text: "still in progress" });
  return { store, parent, tools, builder, endParentTurn };
}

const queuedWakes = (store: EngineStore, sessionId: string) => store.queries.turns(sessionId).filter((turn) => turn.state === "queued" && turn.wakeReason);

test("builders lists what each tasked session is doing, the ones still out first, with where to read each ending", async () => {
  const { tools, parent, builder } = await fleet();
  const parser = await builder("parser");
  const docs = await builder("docs");
  const ui = await builder("ui");
  const result = parser.say("result", "PR #12 is open and CI is green.\nDetails follow.");
  docs.say("blocker", "Which changelog format?");

  const read = await call(tools, "sessions_read", { sessionId: parent.id, view: "builders" });

  expect(read.json!.builders).toEqual([
    { id: docs.id, title: "docs", workState: "waiting on you", updatedAt: expect.any(Number) },
    { id: ui.id, title: "ui", workState: "working", doing: "working", updatedAt: expect.any(Number) },
    {
      id: parser.id,
      title: "parser",
      workState: "done",
      summary: "PR #12 is open and CI is green.",
      read: { sessionId: parent.id, runId: result.runId },
      updatedAt: expect.any(Number),
    },
  ]);
});

test("reading your builders spends their held endings, so the end of the busy turn repeats nothing", async () => {
  const { store, tools, parent, builder, endParentTurn } = await fleet();
  const parser = await builder("parser");
  parser.say("result", "PR #12 is open.");
  expect(store.wakes.pendingNotifications(parent.id)).toHaveLength(1);

  await call(tools, "sessions_read", { sessionId: parent.id, view: "builders" });
  expect(store.wakes.pendingNotifications(parent.id)).toEqual([]);

  endParentTurn();
  expect(queuedWakes(store, parent.id)).toEqual([]);
});

test("without a read, the held ending wakes the orchestrator once, and a read afterwards withdraws it", async () => {
  const { store, tools, parent, builder, endParentTurn } = await fleet();
  const parser = await builder("parser");
  parser.say("result", "PR #12 is open.");

  endParentTurn();
  expect(queuedWakes(store, parent.id).map((turn) => turn.notification?.summary)).toEqual([expect.stringContaining("[builder done]")]);

  await call(tools, "sessions_read", { sessionId: parent.id, view: "builders" });
  expect(queuedWakes(store, parent.id)).toEqual([]);
});

test("another session's builders can be read, and reading them spends nothing of theirs", async () => {
  const { store, parent, builder } = await fleet();
  const parser = await builder("parser");
  parser.say("result", "PR #12 is open.");
  const { tools: outsider } = orchestrator(store, store.records.get(parent.id).projectId!);

  const read = await call(outsider, "sessions_read", { sessionId: parent.id, view: "builders" });

  expect((read.json!.builders as Array<{ workState: string }>).map((row) => row.workState)).toEqual(["done"]);
  expect(store.wakes.pendingNotifications(parent.id)).toHaveLength(1);
});
