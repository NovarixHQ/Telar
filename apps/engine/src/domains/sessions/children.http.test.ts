import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-children-http-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test("a parent's children come back with their state and, while working, what they are doing", async () => {
  const daemon = await startEngine({ models: stubModels, engineRoot: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  const store = daemon.store;
  await client.registerProject({ id: "project_one", name: "One", root: root() });
  await client.createSession({ id: "session_parent", projectId: "project_one", title: "Orchestrator" });
  await client.createSession({ id: "session_child", projectId: "project_one", title: "Settings mockup" });
  expect(await client.children("session_parent")).toEqual({ children: [] });

  store.intake.submitTurn("session_parent", { runId: "run_parent", input: "fan out" });
  const parentToken = store.claims.claimTurn("session_parent", "worker_parent")!.claim!.token;
  store.turnLifecycle.markRunning("session_parent", "run_parent", parentToken);
  store.intake.submitAgentTurn("session_child", { runId: "run_task", input: "Build the mockup.", intent: "task" }, { sessionId: "session_parent", runId: "run_parent", claimToken: parentToken });
  const childToken = store.claims.claimTurn("session_child", "worker_child")!.claim!.token;
  store.turnLifecycle.markRunning("session_child", "run_task", childToken);
  store.ingest.ingestObservations("session_child", "run_task", childToken, [
    { kind: "item.started", item: { id: "item_edit", title: "Edit settings.html", detail: { type: "file_change", change: { kind: "edit", path: "settings.html" } } } },
  ]);

  const { children } = await client.children("session_parent");
  expect(children).toEqual([
    {
      sessionId: "session_child",
      parentSessionId: "session_parent",
      parentRunId: "run_parent",
      title: "Settings mockup",
      provider: "claude",
      state: "working",
      progress: "Edit settings.html · 1 tool",
      startedAt: expect.any(Number),
    },
  ]);
  await expect(client.children("session_missing")).rejects.toThrow();
});
