import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient } from "@telar/engine-client";
import { startEngine } from "../daemon";
import type { TurnDriver } from "../drivers";
import { folderFs, type FolderFs } from "../platform/fs/folder-reach";
import { EngineWorker } from ".";
import { stubModels } from "../../test/stub-models";
import { eventually } from "../../test/wait";
import { daemons, root, setup, teardown, workers } from "../../test/worker-daemon";

afterEach(teardown);

const CLI_EXIT = "Claude Code process exited with code 1. stderr: error: An unknown error occurred (Unexpected)";
const denied = (): Promise<never> => Promise.reject(Object.assign(new Error("operation not permitted"), { code: "EPERM" }));

async function failureOf(client: EngineClient, sessionId: string) {
  await eventually(async () => expect((await client.session(sessionId)).turns[0]?.state).toBe("failed"));
  const failed = (await client.events(sessionId)).events.find((event) => event.type === "turn.failed");
  if (failed?.type !== "turn.failed") throw new Error("no turn.failed event");
  return failed;
}

const countingDriver = (onRun: () => Promise<{ text: string }> = async () => ({ text: "" })) => {
  const calls = { count: 0 };
  const driver: TurnDriver = { run: () => ((calls.count += 1), onRun()) };
  return { driver, calls };
};

test("a project folder that no longer exists fails the turn with the folder named, and nothing spawns", async () => {
  const { driver, calls } = countingDriver();
  const daemon = await startEngine({ models: stubModels, engineRoot: root(), workerLeaseMs: 60_000 });
  daemons.push(daemon);
  const client = new EngineClient(daemon.discovery);
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), "telar-stale-"));
  await client.registerProject({ id: "project_stale", name: "Stale", root: stale });
  await client.createSession({ id: "session_stale", projectId: "project_stale" });
  fs.rmSync(stale, { recursive: true, force: true });
  const worker = new EngineWorker({ client, workerId: "worker_stale", driver, pollMs: 60_000 });
  workers.push(worker);
  await worker.start();
  await client.submitTurn("session_stale", { runId: "run_stale", input: "Hello" });
  await worker.tick();

  const failed = await failureOf(client, "session_stale");
  expect(failed.code).toBe("workspace_unavailable");
  expect(failed.message).toContain(fs.realpathSync.native(os.tmpdir()));
  expect(failed.message).toMatch(/isn't reachable.*no longer exists/);
  expect(calls.count).toBe(0);
});

test("a folder a security tool denies fails before the provider spawns", async () => {
  const { driver, calls } = countingDriver();
  const fs: FolderFs = { ...folderFs, peek: denied };
  const { client, sessionId, worker } = await setup(driver, { folderCheck: { fs } });
  await client.submitTurn(sessionId, { runId: "run_one", input: "Hello" });
  await worker.tick();

  const failed = await failureOf(client, sessionId);
  expect(failed.code).toBe("workspace_unavailable");
  expect(failed.message).toMatch(/isn't reachable: .*Permission was denied by macOS or a security tool/);
  expect(calls.count).toBe(0);
});

test("a drive that never answers fails the turn as unresponsive instead of holding the worker", async () => {
  const { driver, calls } = countingDriver();
  const fs: FolderFs = { ...folderFs, stat: () => new Promise(() => undefined) };
  const { client, sessionId, worker } = await setup(driver, { folderCheck: { fs, timeoutMs: 20 } });
  await client.submitTurn(sessionId, { runId: "run_one", input: "Hello" });
  await worker.tick();

  const failed = await failureOf(client, sessionId);
  expect(failed.message).toMatch(/The drive isn't responding/);
  expect(calls.count).toBe(0);
});

test("a provider that exits non-zero once its folder is lost reports the folder, with its own words kept as detail", async () => {
  let lost = false;
  const fs: FolderFs = { ...folderFs, peek: (target) => (lost ? denied() : folderFs.peek(target)) };
  const { driver, calls } = countingDriver(async () => {
    lost = true;
    throw new Error(CLI_EXIT);
  });
  const { client, sessionId, worker } = await setup(driver, { folderCheck: { fs } });
  await client.submitTurn(sessionId, { runId: "run_one", input: "Hello" });
  await worker.tick();

  const failed = await failureOf(client, sessionId);
  expect(calls.count).toBe(1);
  expect(failed.code).toBe("workspace_unavailable");
  expect(failed.message).toMatch(/Permission was denied/);
  expect(failed.detail).toBe(CLI_EXIT);
});

test("a provider that exits non-zero in a reachable folder keeps its own message", async () => {
  const { driver } = countingDriver(async () => {
    throw new Error(CLI_EXIT);
  });
  const { client, sessionId, worker } = await setup(driver);
  await client.submitTurn(sessionId, { runId: "run_one", input: "Hello" });
  await worker.tick();

  const failed = await failureOf(client, sessionId);
  expect(failed.code).toBe("driver_failed");
  expect(failed.message).toBe(CLI_EXIT);
  expect(failed.detail).toBeUndefined();
});
