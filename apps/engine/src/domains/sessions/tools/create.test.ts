import { afterEach, describe, expect, test } from "bun:test";
import { worktreeReady } from "../../../../test/worktree-ready";
import { call, cleanUp, engine, orchestrator, wall, withModelCatalogue } from "./test-helpers";

afterEach(cleanUp);

describe("sessions_create with a task", () => {
  test("the new session is tasked, filed as the caller's child, and comes back with its link", async () => {
    const { store, projectId } = engine();
    withModelCatalogue(store);
    const { parent, tools } = orchestrator(store, projectId);
    const created = await call(tools, "sessions_create", { projectId, envMode: "local", title: "port the parser", task: "Port the parser to the new AST.", model: "claude-sonnet-5", effort: "high" });

    expect(created.isError).toBe(false);
    const id = created.json!.id as string;
    expect(created.json!.link).toBe(`/projects/${projectId}/sessions/${id}`);
    expect(created.json!.model).toBe("claude-sonnet-5 at high");
    expect(store.queries.turns(id).map((turn) => ({ runId: turn.runId, intent: turn.agentIntent, sender: turn.sender }))).toEqual([
      { runId: created.json!.runId as string, intent: "task", sender: { sessionId: parent.id } },
    ]);
    expect(store.children.childrenOf(parent.id)).toEqual([expect.objectContaining({ sessionId: id, title: "port the parser", state: "working" })]);
    expect(String(created.json!.note)).toContain("end your turn");
  });
});

describe("sessions_create without envMode", () => {
  test("a local project's workers share its checkout, and a worktree project's get their own", async () => {
    for (const mode of ["local", "worktree"] as const) {
      const { store, projectId } = engine();
      store.projectRegistry.update(projectId, { envMode: mode });
      const one = await call(wall(store), "sessions_create", { projectId });
      const id = one.json!.id as string;
      expect(store.records.get(id).workspace.mode).toBe(mode);
      if (mode === "worktree") await worktreeReady(store, id);
    }
  });

  test("an explicit envMode wins over the project's", async () => {
    const { store, projectId } = engine();
    store.projectRegistry.update(projectId, { envMode: "worktree" });
    const created = await call(wall(store), "sessions_create", { projectId, envMode: "local" });
    expect(store.records.get(created.json!.id as string).workspace.mode).toBe("local");
  });
});
