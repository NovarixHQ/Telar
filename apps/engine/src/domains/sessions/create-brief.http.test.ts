import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, type EngineClientError } from "@telar/engine-client";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];
const root = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "telar-session-create-brief-"));
  roots.push(directory);
  return directory;
};
afterEach(async () => {
  for (const daemon of daemons.splice(0).reverse()) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

async function ready() {
  const daemon = await startEngine({ models: stubModels, engineRoot: root() });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  await client.registerProject({ id: "project_one", name: "One", root: root() });
  return client;
}

test("a brief becomes the person's first turn in the session the call created", async () => {
  const client = await ready();
  const { session } = await client.createSession({ projectId: "project_one", title: "Mine", detached: false, brief: { runId: "run_brief", input: "Where do I start?" } });

  const { turns } = await client.session(session.id);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ runId: "run_brief", input: "Where do I start?" });
  expect(turns[0]!.origin).toBeUndefined();
  expect(turns[0]!.agentIntent).toBeUndefined();
  expect(session.startedFrom).toBeUndefined();
});

test("a brief is ignored when the id already names a session", async () => {
  const client = await ready();
  const id = "session_brief00000004f4b8f0e1d2c3b4a59";
  await client.createSession({ id, projectId: "project_one" });
  await client.createSession({ id, projectId: "project_one", brief: { runId: "run_late", input: "slipped in" } });

  expect((await client.session(id)).turns).toEqual([]);
});

test("a brief without text is refused before a session is made", async () => {
  const client = await ready();
  const refused = await client.createSession({ projectId: "project_one", brief: { runId: "run_empty", input: "" } }).catch((error: EngineClientError) => error);

  expect((refused as EngineClientError).status).toBe(400);
  expect((await client.listSessions("project_one")).sessions).toEqual([]);
});
